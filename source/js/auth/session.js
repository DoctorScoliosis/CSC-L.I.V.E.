/*
 * Authentication and session handling for the dashboard pages.
 *
 * This file owns the "who is signed in" logic that used to be copy-pasted
 * across index.html, AdminDashboard.html and CommitteeDashboard.html:
 *
 *   - reading and writing the cached user blob in sessionStorage ("user")
 *   - the synchronous guard (checkDashboardAuth) that sends signed-out or
 *     wrong-role visitors back to index.html
 *   - the full profile loader (loadDashboardUser) that re-validates the
 *     Supabase session against the user_profiles table on every page load
 *   - small display helpers for the sidebar identity badge
 *   - sign-out with redirect (signOutAndRedirect)
 *
 * The Student dashboard does NOT use this module — it is public and runs
 * on the anon key with no signed-in user.
 *
 * QUIRK (preserved on purpose): checkDashboardAuth only blocks a stored
 * user when approvalStatus is present AND not "approved". A stored user
 * with no approvalStatus field at all is allowed through. This matches
 * the original behaviour exactly — do not "fix" it without checking every
 * page that relies on the guard.
 */

import { supabase } from "../supabase-client.js";
import { ACCOUNT_PROFILES_TABLE, SESSION_USER_KEY } from "../config.js";
import { normalizeComparableValue } from "../utils/normalize.js";

// --- Session storage ----------------------------------------------------------
// The cached user blob lives in sessionStorage under "user" (see config.js).
// sessionStorage is per-tab, which is what lets one tab be signed in as
// admin while another is signed in as committee.

export function getStoredUser() {
	const rawValue = sessionStorage.getItem(SESSION_USER_KEY);
	if (!rawValue) {
		return null;
	}
	try {
		return JSON.parse(rawValue);
	} catch (error) {
		// Corrupt blob: drop it so the next check sends the visitor to
		// the login page instead of crashing on a half-parsed object.
		console.warn("Stored user data is invalid:", error.message || error);
		sessionStorage.removeItem(SESSION_USER_KEY);
		return null;
	}
}

export function saveSessionUser(userData) {
	sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(userData));
}

export function clearStoredUser() {
	sessionStorage.removeItem(SESSION_USER_KEY);
}

// --- Status and role normalisation ---------------------------------------------

export function normalizeApprovalStatus(status) {
	return normalizeComparableValue(status);
}

export function normalizeAccountRole(role) {
	return normalizeComparableValue(role);
}

export function isApprovedStatus(status) {
	return normalizeApprovalStatus(status) === "approved";
}

export function isApprovedProfile(profile) {
	return isApprovedStatus(profile?.approval_status);
}

// --- User normalisation ----------------------------------------------------------
// One normaliser for every page. roleDefault is "committee" for the
// committee dashboard and "admin" for the admin dashboard; the extra
// fields (assignedSportId, loginTime, ...) are harmless on pages that
// never read them.

export function normalizeDashboardUser(userData, options = {}) {
	if (!userData) {
		return null;
	}
	const roleDefault = options.roleDefault || "committee";
	return {
		id: userData.id || userData.user_id || "",
		email: userData.email || "",
		fullName: userData.fullName || userData.full_name || userData.name || "",
		mobileNumber: userData.mobileNumber || userData.mobile_number || "",
		role: normalizeAccountRole(userData.role || roleDefault),
		assignedSportId: String(
			userData.assignedSportId
			|| userData.assigned_sport_id
			|| userData.assigned_game_id
			|| userData.sport_id
			|| ""
		).trim(),
		assignedSportName: String(
			userData.assignedSportName
			|| userData.assigned_sport_name
			|| userData.assigned_game_name
			|| userData.assigned_sport
			|| userData.sport_name
			|| userData.sport
			|| ""
		).trim(),
		approvalStatus: normalizeApprovalStatus(userData.approvalStatus || userData.approval_status || "approved"),
		loginTime: userData.loginTime || new Date().toISOString(),
		authProvider: userData.authProvider || "supabase"
	};
}

// --- Profile validation -----------------------------------------------------------

export async function fetchUserProfile(userId) {
	const { data, error } = await supabase
		.from(ACCOUNT_PROFILES_TABLE)
		.select("*")
		.eq("id", userId)
		.maybeSingle();
	if (error) {
		throw error;
	}
	return data;
}

// Checks identity and role only — NOT approval status. Callers that need
// approval handling (the login page shows different messages for pending,
// hold and suspended) check it separately with isApprovedStatus.
// Throws an Error with a displayable message when anything is wrong.
export function validateProfileOwnership(authUser, profile, allowedRoles) {
	if (!authUser?.id || !profile?.id) {
		throw new Error("No registered database profile was found for this account.");
	}
	if (String(profile.id) !== String(authUser.id)) {
		throw new Error("The authenticated account does not match the registered database profile.");
	}
	const authEmail = String(authUser.email || "").trim().toLowerCase();
	const profileEmail = String(profile.email || "").trim().toLowerCase();
	if (!authEmail || !profileEmail || authEmail !== profileEmail) {
		throw new Error("The authenticated email does not match the registered account.");
	}
	const role = normalizeAccountRole(profile.role);
	const roles = Array.isArray(allowedRoles) ? allowedRoles.map(normalizeAccountRole) : [];
	if (!roles.includes(role)) {
		throw new Error("This account does not have a valid dashboard role.");
	}
	return role;
}

// --- Full loader and synchronous guard ----------------------------------------------

// Re-validates the Supabase session against user_profiles, caches the
// normalised user in sessionStorage and returns it. On ANY failure it
// signs out, clears the cache, redirects to index.html and returns null.
//
// allowedRoles: ["admin"] for AdminDashboard, ["committee", "admin"] for
// CommitteeDashboard.
export async function loadDashboardUser(options = {}) {
	const allowedRoles = Array.isArray(options.allowedRoles) ? options.allowedRoles : ["committee", "admin"];
	const roleDefault = options.roleDefault || "committee";
	let resolvedUser = null;
	try {
		const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
		if (sessionError || !sessionData?.session) {
			throw sessionError || new Error("No active dashboard session.");
		}
		const { data: authData, error: authError } = await supabase.auth.getUser();
		if (authError || !authData?.user) {
			throw authError || new Error("No authenticated dashboard session.");
		}
		const authUser = authData.user;
		const profile = await fetchUserProfile(authUser.id);
		const role = validateProfileOwnership(authUser, profile, allowedRoles);
		if (!isApprovedStatus(profile.approval_status)) {
			throw new Error("The authenticated account is not an approved profile.");
		}
		resolvedUser = normalizeDashboardUser({
			id: profile.id,
			email: profile.email,
			fullName: profile.full_name || authUser.user_metadata?.full_name || "",
			mobile_number: profile.mobile_number || authUser.user_metadata?.mobile_number || "",
			role,
			assigned_sport_id: profile.assigned_sport_id || profile.assigned_game_id || profile.sport_id || "",
			assigned_sport_name: profile.assigned_sport_name || profile.assigned_game_name || profile.assigned_sport || profile.sport_name || profile.sport || "",
			approvalStatus: profile.approval_status,
			loginTime: new Date().toISOString(),
			authProvider: "supabase"
		}, { roleDefault });
		saveSessionUser(resolvedUser);
	} catch (error) {
		console.warn("Current user lookup failed:", error.message || error);
		// The original pages did not guard this signOut call; wrapping it
		// means a flaky sign-out can never strand the visitor on a dead
		// dashboard — the redirect below always runs.
		try {
			await supabase.auth.signOut();
		} catch (signOutError) {
			console.warn("Supabase sign out could not complete:", signOutError.message || signOutError);
		}
		clearStoredUser();
		window.location.href = "index.html";
		return null;
	}
	return resolvedUser;
}

// The synchronous page guard. Call this from the page entry module before
// doing anything else:
//   checkDashboardAuth(["admin"]);              // AdminDashboard
//   checkDashboardAuth(["committee", "admin"]); // CommitteeDashboard
export function checkDashboardAuth(allowedRoles) {
	const userData = getStoredUser();
	if (!userData) {
		window.location.href = "index.html";
		return;
	}
	const roles = Array.isArray(allowedRoles) ? allowedRoles.map(normalizeAccountRole) : [];
	if (!roles.includes(normalizeAccountRole(userData.role))) {
		window.location.href = "index.html";
		return;
	}
	// See the QUIRK note in the header comment: a missing approvalStatus
	// is allowed through; only a present, non-approved value blocks.
	if (userData.approvalStatus && normalizeApprovalStatus(userData.approvalStatus) !== "approved") {
		window.location.href = "index.html";
	}
}

// --- Sign out -----------------------------------------------------------------------
// extraStorageKeys lets each page clear its own tab-persistence keys
// (e.g. "adminDashboardSessionStarted") without this module knowing
// about them.

export async function signOutAndRedirect(extraStorageKeys = []) {
	try {
		await supabase.auth.signOut();
	} catch (error) {
		console.warn("Supabase sign out could not complete:", error.message || error);
	}
	clearStoredUser();
	extraStorageKeys.forEach(key => sessionStorage.removeItem(key));
	window.location.href = "index.html";
}

// --- Login page helpers ----------------------------------------------------------------

export function getApprovalBlockMessage(status) {
	const normalizedStatus = normalizeApprovalStatus(status);
	const statusMessages = {
		hold: "Your account is on hold. Please contact an admin before logging in.",
		suspended: "Your account is suspended. Please contact an admin before logging in.",
		rejected: "Your account is rejected. Please contact an admin before logging in.",
		pending: "Your account is pending admin approval. Please wait for an admin to accept it before logging in."
	};
	return statusMessages[normalizedStatus]
		|| `Your account status is ${normalizedStatus}. Please contact an admin before logging in.`;
}

// --- Display helpers for the sidebar identity badge --------------------------------------

export function getUserDisplayName(userData) {
	return userData?.fullName
		|| userData?.full_name
		|| userData?.name
		|| userData?.email
		|| "Current Account";
}

export function getUserInitial(userData) {
	const sourceName = String(
		userData?.fullName
		|| userData?.full_name
		|| userData?.name
		|| userData?.email
		|| "?"
	).trim();
	if (!sourceName) {
		return "?";
	}
	return sourceName.charAt(0).toUpperCase();
}

export function getDashboardRoleLabel(userData) {
	const role = normalizeAccountRole(userData?.role);
	if (role === "admin") {
		return "Admin Account";
	}
	if (role === "committee") {
		return "Committee Account";
	}
	return "Signed in";
}
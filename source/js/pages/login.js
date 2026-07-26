/*
 * Login and registration page controller (index.html).
 *
 * This is the entry point for the login page. It handles:
 *   - switching between Log In and Sign In (registration) modes
 *   - signing in as admin or committee and routing to the right dashboard
 *   - creating new pending accounts via the save_pending_user_profile RPC
 *   - the registration sport picker (grouped by general sport name)
 *
 * All event listeners are attached here with addEventListener — the HTML
 * has no inline onclick handlers — so nothing needs to be exposed on
 * window.
 *
 * The two legacy localStorage keys are cleared at the top. They were used
 * by older builds that stored the session in localStorage. The dashboard
 * client (created at import time in supabase-client.js) uses sessionStorage
 * only, so clearing these after the client exists is safe and changes
 * nothing about the current session handling.
 */

import { supabase } from "../supabase-client.js";
import {
	SPORTS_TABLE,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME
} from "../config.js";
import {
	fetchUserProfile,
	validateProfileOwnership,
	isApprovedProfile,
	getApprovalBlockMessage,
	normalizeApprovalStatus,
	saveSessionUser,
	clearStoredUser
} from "../auth/session.js";
import { escapeHTML } from "../utils/dom.js";
import { normalizeSportGroupKey } from "../utils/normalize.js";
import { getGeneralSportName } from "../utils/sports.js";

// Clear credentials cached by older builds. See the header comment for why
// this is safe to run after the client has been created.
localStorage.removeItem("user");
localStorage.removeItem("sb-unveyndaaznxgqojwjki-auth-token");

const OVERALL_COMMITTEE_ASSIGNMENT = {
	id: OVERALL_COMMITTEE_SPORT_ID,
	sport_name: OVERALL_COMMITTEE_SPORT_NAME
};

// --- DOM references ----------------------------------------------------------
const signInForm = document.getElementById("signInForm");
const registerForm = document.getElementById("registerForm");
const formTitle = document.getElementById("formTitle");
const formSubtitle = document.getElementById("formSubtitle");
const helperText = document.getElementById("helperText");
const alertBox = document.getElementById("alertBox");
const alertMessage = document.getElementById("alertMessage");
const signInSubmit = document.getElementById("signInSubmit");
const registerSubmit = document.getElementById("registerSubmit");
const openRegisterSportModal = document.getElementById("openRegisterSportModal");
const closeRegisterSportModal = document.getElementById("closeRegisterSportModal");
const registerSportModal = document.getElementById("registerSportModal");
const registerSportList = document.getElementById("registerSportList");
const selectedRegisterSportLabel = document.getElementById("selectedRegisterSportLabel");
const registerSportAssignmentGroup = document.getElementById("registerSportAssignmentGroup");

// --- Page state --------------------------------------------------------------
let currentMode = "signin";
let selectedSignInRole = "admin";
let selectedRegisterRole = "committee";
let registeredSports = [];
let selectedRegisterSport = null;

// --- Small UI helpers --------------------------------------------------------
function showAlert(type, message) {
	alertBox.classList.remove("hidden", "bg-red-50", "border-red-200", "bg-green-50", "border-green-200", "bg-yellow-50", "border-yellow-200");
	alertMessage.className = "text-sm";
	if (type === "success") {
		alertBox.classList.add("bg-green-50", "border-green-200");
		alertMessage.classList.add("text-green-800");
	} else if (type === "warning") {
		alertBox.classList.add("bg-yellow-50", "border-yellow-200");
		alertMessage.classList.add("text-yellow-800");
	} else {
		alertBox.classList.add("bg-red-50", "border-red-200");
		alertMessage.classList.add("text-red-800");
	}
	alertMessage.textContent = message;
}

function hideAlert() {
	alertBox.classList.add("hidden");
	alertMessage.textContent = "";
}

function setLoading(button, isLoading, loadingText, normalText) {
	button.disabled = isLoading;
	button.textContent = isLoading ? loadingText : normalText;
}

// --- Mode and role switching -------------------------------------------------
function setMode(mode) {
	currentMode = mode;
	hideAlert();
	document.querySelectorAll(".mode-btn").forEach(button => {
		button.classList.toggle("active", button.dataset.mode === mode);
	});
	if (mode === "signin") {
		signInForm.classList.remove("hidden");
		registerForm.classList.add("hidden");
		formTitle.textContent = "Welcome Back";
		formSubtitle.textContent = "Log in to access CSC-L.I.V.E.";
		helperText.innerHTML = `
		No account yet?
		<button type="button" id="goRegister" class="font-semibold text-blue-600 hover:text-blue-700">
		Sign in here.
		</button>
		`;
		document.getElementById("goRegister").addEventListener("click", () => setMode("register"));
	} else {
		signInForm.classList.add("hidden");
		registerForm.classList.remove("hidden");
		formTitle.textContent = "Create Account";
		helperText.innerHTML = `
		Already have an account?
		<button type="button" id="goSignIn" class="font-semibold text-blue-600 hover:text-blue-700">
		Log in here.
		</button>
		`;
		document.getElementById("goSignIn").addEventListener("click", () => setMode("signin"));
	}
}

function openAuthMode(mode) {
	setMode(mode);
	document.getElementById("authForms")?.scrollIntoView({
		behavior: "smooth",
		block: "start"
	});
}

function setSignInRole(role) {
	selectedSignInRole = role;
	document.querySelectorAll(".signin-role-btn").forEach(button => {
		button.classList.toggle("active", button.dataset.signinRole === role);
	});
}

function setRegisterRole(role) {
	selectedRegisterRole = role;
	document.querySelectorAll(".role-btn").forEach(button => {
		button.classList.toggle("active", button.dataset.role === role);
	});
	const isAdmin = role === "admin";
	registerSportAssignmentGroup.classList.toggle("hidden", isAdmin);
	selectedRegisterSportLabel.textContent = isAdmin
		? "Admin"
		: selectedRegisterSport?.sport_name || "Choose the sport you will handle";
}

// --- Registration sport picker -----------------------------------------------
function getRegisterSportGroups() {
	const groups = new Map();
	registeredSports.forEach(sport => {
		const sportName = sport.sport_name || sport.name || "Unnamed sport";
		const generalName = getGeneralSportName(sportName);
		const key = normalizeSportGroupKey(generalName);
		if (!groups.has(key)) {
			groups.set(key, {
				id: `__sport_group__:${key}`,
				sport_name: generalName,
				isGeneralSportGroup: true,
				sourceSports: []
			});
		}
		groups.get(key).sourceSports.push(sport);
	});
	return [...groups.values()].sort((a, b) => a.sport_name.localeCompare(b.sport_name));
}

function renderRegisterSports() {
	if (!registerSportList) {
		return;
	}
	const groupedSports = getRegisterSportGroups();
	const sportOptions = [OVERALL_COMMITTEE_ASSIGNMENT, ...groupedSports];
	registerSportList.innerHTML = `
	<button
	type="button"
	data-register-sport-id="${OVERALL_COMMITTEE_ASSIGNMENT.id}"
	class="register-sport-option w-full rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${String(selectedRegisterSport?.id || "") === OVERALL_COMMITTEE_ASSIGNMENT.id ? "border-blue-600 bg-blue-50 text-blue-800" : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"}">
	Overall Committee
	<span class="mt-1 block text-xs font-semibold text-amber-700">Can schedule matches for all sports categories.</span>
	</button>
	${groupedSports.length === 0 ? `<p class="rounded-xl bg-gray-50 p-4 text-sm font-semibold text-gray-500">No registered sports are available yet.</p>` : ""}
	` + groupedSports.map(sport => `
	<button
	type="button"
	data-register-sport-id="${sport.id}"
	class="register-sport-option w-full rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${String(selectedRegisterSport?.id || "") === String(sport.id) ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50"}">
	${escapeHTML(sport.sport_name || "Unnamed sport")}
	</button>
	`).join("");
	document.querySelectorAll(".register-sport-option").forEach(button => {
		button.addEventListener("click", function () {
			selectedRegisterSport = sportOptions.find(sport => String(sport.id) === String(this.dataset.registerSportId)) || null;
			selectedRegisterSportLabel.textContent = selectedRegisterSport?.sport_name || "Choose the sport you will handle";
			closeRegisterSportModalFunction();
		});
	});
}

async function loadRegisterSports() {
	const { data, error } = await supabase
		.from(SPORTS_TABLE)
		.select("id, sport_name")
		.order("sport_name", { ascending: true });
	if (error) {
		console.error("Registration sports load error:", error.message || error);
		registerSportList.innerHTML = `<p class="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">Unable to load registered sports.</p>`;
		return;
	}
	registeredSports = data || [];
	renderRegisterSports();
}

function openRegisterSportModalFunction() {
	renderRegisterSports();
	registerSportModal.classList.remove("hidden");
	registerSportModal.classList.add("flex");
}

function closeRegisterSportModalFunction() {
	registerSportModal.classList.add("hidden");
	registerSportModal.classList.remove("flex");
}

// --- Session and routing -----------------------------------------------------
function redirectByRole(role) {
	sessionStorage.removeItem("adminDashboardSessionStarted");
	sessionStorage.removeItem("committeeDashboardSessionStarted");
	if (role === "admin") {
		window.location.href = "AdminDashboard.html";
		return;
	}
	window.location.href = "CommitteeDashboard.html";
}

async function saveLocalSession(user, profile) {
	const finalRole = validateProfileOwnership(user, profile, ["admin", "committee"]);
	const userData = {
		id: user.id,
		email: profile?.email || user.email,
		fullName: profile?.full_name || user.user_metadata?.full_name || "",
		mobileNumber: profile?.mobile_number || user.user_metadata?.mobile_number || "",
		role: finalRole,
		approvalStatus: normalizeApprovalStatus(profile.approval_status),
		loginTime: new Date().toISOString(),
		authProvider: "supabase"
	};
	saveSessionUser(userData);
	return userData;
}

async function ensurePendingProfile(user, fullName, mobileNumber, role, sport) {
	if (!user?.id) {
		throw new Error("Account was created, but the user profile could not be identified.");
	}
	const isOverallCommittee = sport?.id === OVERALL_COMMITTEE_ASSIGNMENT.id;
	const isGeneralSportGroup = Boolean(sport?.isGeneralSportGroup);
	const { error } = await supabase.rpc("save_pending_user_profile", {
		p_email: user.email,
		p_full_name: fullName,
		p_mobile_number: mobileNumber,
		p_role: role,
		p_assigned_sport_id: isOverallCommittee || isGeneralSportGroup ? null : (sport?.id || null),
		p_assigned_sport_name: isOverallCommittee ? OVERALL_COMMITTEE_ASSIGNMENT.sport_name : (sport?.sport_name || null)
	});
	if (error) {
		throw error;
	}
}

// --- Event wiring ------------------------------------------------------------
document.querySelectorAll(".mode-btn").forEach(button => {
	button.addEventListener("click", () => setMode(button.dataset.mode));
});
document.querySelectorAll("[data-hero-auth-mode]").forEach(button => {
	button.addEventListener("click", () => openAuthMode(button.dataset.heroAuthMode));
});
document.querySelectorAll(".signin-role-btn").forEach(button => {
	button.addEventListener("click", () => setSignInRole(button.dataset.signinRole));
});
document.querySelectorAll(".role-btn").forEach(button => {
	button.addEventListener("click", () => setRegisterRole(button.dataset.role));
});
document.getElementById("goRegister").addEventListener("click", () => setMode("register"));
openRegisterSportModal.addEventListener("click", openRegisterSportModalFunction);
closeRegisterSportModal.addEventListener("click", closeRegisterSportModalFunction);
registerSportModal.addEventListener("click", event => {
	if (event.target === registerSportModal) {
		closeRegisterSportModalFunction();
	}
});
loadRegisterSports();

signInForm.addEventListener("submit", async function (event) {
	event.preventDefault();
	hideAlert();
	let authenticated = false;
	const email = document.getElementById("signInEmail").value.trim();
	const password = document.getElementById("signInPassword").value;
	if (!email || !password) {
		showAlert("error", "Please enter your email and password.");
		return;
	}
	setLoading(signInSubmit, true, "Logging in...", "Log In");
	try {
		const { data, error } = await supabase.auth.signInWithPassword({
			email,
			password
		});
		if (error) {
			throw error;
		}
		authenticated = true;
		const profile = await fetchUserProfile(data.user.id);
		const actualRole = validateProfileOwnership(data.user, profile, ["admin", "committee"]);
		if (!isApprovedProfile(profile)) {
			await supabase.auth.signOut();
			clearStoredUser();
			showAlert("warning", getApprovalBlockMessage(profile?.approval_status));
			return;
		}
		if (actualRole !== selectedSignInRole) {
			await supabase.auth.signOut();
			clearStoredUser();
			const correctRoleLabel = actualRole === "admin" ? "Admin" : "Committee";
			const selectedRoleLabel = selectedSignInRole === "admin" ? "Admin" : "Committee";
			showAlert(
				"error",
				`This account is registered as ${correctRoleLabel}, but you selected ${selectedRoleLabel}. Please choose the correct log-in role.`
			);
			return;
		}
		const userData = await saveLocalSession(data.user, profile);
		redirectByRole(userData.role);
	} catch (error) {
		console.error("Log in error:", error);
		if (authenticated) {
			await supabase.auth.signOut();
			clearStoredUser();
		}
		showAlert("error", error.message || "Failed to log in. Check your account and password.");
	} finally {
		setLoading(signInSubmit, false, "Logging in...", "Log In");
	}
});

registerForm.addEventListener("submit", async function (event) {
	event.preventDefault();
	hideAlert();
	const fullName = document.getElementById("registerName").value.trim();
	const email = document.getElementById("registerEmail").value.trim();
	const mobileNumber = document.getElementById("registerMobile").value.trim();
	const password = document.getElementById("registerPassword").value;
	const confirmPassword = document.getElementById("confirmPassword").value;
	if (!fullName || !email || !mobileNumber || !password || !confirmPassword) {
		showAlert("error", "Please complete all registration fields.");
		return;
	}
	if (selectedRegisterRole === "committee" && !selectedRegisterSport) {
		showAlert("error", "Please choose the sport you will handle.");
		openRegisterSportModalFunction();
		return;
	}
	if (password.length < 6) {
		showAlert("error", "Password must be at least 6 characters.");
		return;
	}
	if (password !== confirmPassword) {
		showAlert("error", "Passwords do not match.");
		return;
	}
	setLoading(registerSubmit, true, "Creating account...", "Create Account");
	try {
		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: {
					full_name: fullName,
					mobile_number: mobileNumber,
					role: selectedRegisterRole
				}
			}
		});
		if (error) {
			throw error;
		}
		const registeredRole = selectedRegisterRole;
		const registeredSport = registeredRole === "admin"
			? { id: null, sport_name: "Admin" }
			: selectedRegisterSport;
		await ensurePendingProfile(data.user, fullName, mobileNumber, registeredRole, registeredSport);
		/*
		 * Supabase can create an active session immediately after sign-up when
		 * email confirmation is disabled. The user must NOT be redirected now —
		 * they sign in again so the dashboard opens under the account they chose.
		 */
		try {
			const { error: signOutError } = await supabase.auth.signOut();
			if (signOutError) {
				console.warn("Account was created, but automatic post-registration sign-out returned:", signOutError.message || signOutError);
			}
		} catch (signOutCatchError) {
			console.warn("Account was created, but automatic post-registration sign-out could not complete:", signOutCatchError.message || signOutCatchError);
		}
		clearStoredUser();
		registerForm.reset();
		setRegisterRole("committee");
		selectedRegisterSport = null;
		selectedRegisterSportLabel.textContent = "Choose the sport you will handle";
		setMode("signin");
		setSignInRole(registeredRole);
		document.getElementById("signInEmail").value = email;
		document.getElementById("signInPassword").value = "";
		showAlert("success", "Account created successfully. Please wait for admin approval before logging in.");
	} catch (error) {
		console.error("Register error:", error);
		showAlert("error", error.message || "Failed to create account. Please check your Supabase setup.");
	} finally {
		setLoading(registerSubmit, false, "Creating account...", "Create Account");
	}
});

// If this tab already has a valid Supabase session, refresh its cached
// dashboard profile before anything else runs.
const { data: sessionData } = await supabase.auth.getSession();
if (sessionData?.session?.user) {
	try {
		const profile = await fetchUserProfile(sessionData.session.user.id);
		if (isApprovedProfile(profile)) {
			await saveLocalSession(sessionData.session.user, profile);
		} else {
			await supabase.auth.signOut();
			clearStoredUser();
		}
	} catch (error) {
		console.warn("Existing session found, but profile could not be loaded:", error.message || error);
		await supabase.auth.signOut();
		clearStoredUser();
	}
}
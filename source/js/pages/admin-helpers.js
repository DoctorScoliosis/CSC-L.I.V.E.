/*
 * Shared domain helpers for the Admin dashboard.
 *
 * Cross-cutting normalizers and formatters used by two or more admin feature
 * modules: account status/role labels, sport-group assignment logic, contact
 * display helpers, and participant status normalization. Feature-specific
 * helpers stay in their own modules.
 *
 * Imports state from admin-context.js (one-way). Does not touch the DOM.
 */

import {
	state,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME
} from "./admin-context.js";
import { normalizeComparableValue } from "../utils/normalize.js";
import { escapeHTML } from "../utils/dom.js";

// --- Account status / role ---------------------------------------------------
export function normalizeAccountStatus(status) {
	return String(status || "pending").trim().toLowerCase();
}

export function getAccountStatusClass(status) {
	const normalizedStatus = normalizeAccountStatus(status);
	if (normalizedStatus === "approved") {
		return "bg-emerald-100 text-emerald-700";
	}
	if (normalizedStatus === "hold") {
		return "bg-amber-100 text-amber-700";
	}
	if (normalizedStatus === "suspended") {
		return "bg-orange-100 text-orange-700";
	}
	if (normalizedStatus === "rejected") {
		return "bg-red-100 text-red-700";
	}
	return "bg-yellow-100 text-yellow-700";
}

export function getAccountStatusLabel(status) {
	const normalizedStatus = normalizeAccountStatus(status);
	if (normalizedStatus === "approved") {
		return "Accepted";
	}
	if (normalizedStatus === "hold") {
		return "On Hold";
	}
	return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
}

export function getAccountRoleLabel(role) {
	return String(role || "committee").trim().toLowerCase() === "admin" ? "Admin" : "Committee";
}

export function getAccountMobileNumber(account) {
	return String(account?.mobile_number || account?.mobileNumber || account?.phone || "").trim();
}

export function getCallHref(mobileNumber) {
	const normalizedNumber = String(mobileNumber || "").replace(/[^\d+]/g, "");
	return normalizedNumber ? `tel:${normalizedNumber}` : "";
}

// --- Sport assignment --------------------------------------------------------
export function getAssignedSportId(account) {
	return String(account?.assigned_sport_id || account?.assigned_game_id || account?.sport_id || "").trim();
}

export function getAssignedSportName(account) {
	return String(
		account?.assigned_sport_name ||
		account?.assigned_game_name ||
		account?.assigned_game ||
		account?.assigned_sport ||
		""
	).trim();
}

export function isOverallCommitteeAssignment(account) {
	return getAssignedSportId(account) === OVERALL_COMMITTEE_SPORT_ID
		|| getAssignedSportName(account).toLowerCase() === OVERALL_COMMITTEE_SPORT_NAME.toLowerCase();
}

export function getAccountAssignedSportLabel(account) {
	const assignedSportId = getAssignedSportId(account);
	if (isOverallCommitteeAssignment(account)) {
		return OVERALL_COMMITTEE_SPORT_NAME;
	}
	const sport = state.sportsData.find(item => String(item.id) === assignedSportId);
	return sport?.sport_name || getAssignedSportName(account) || "No game assigned";
}

export function normalizeSportGroupKey(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

export function getGeneralSportName(name) {
	const cleanedName = String(name || "Unnamed sport")
		.replace(/\s+/g, " ")
		.trim();
	const categoryStartWords = new Set([
		"a", "b", "c", "d", "e",
		"boys", "boy", "girls", "girl",
		"men", "man", "mens", "male", "s",
		"women", "woman", "womens", "female",
		"mixed", "singles", "single", "doubles", "double",
		"relay", "backstroke", "butterfly", "freestyle",
		"division", "div", "category", "cat",
		"bracket", "pool", "group", "class"
	]);
	const normalizedName = cleanedName
		.replace(/[()']/g, " ")
		.replace(/[-:/]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const tokens = normalizedName.split(" ").filter(Boolean);
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index].toLowerCase();
		if (
			categoryStartWords.has(token)
			|| /^[a-e]$/i.test(token)
			|| /^\d/.test(token)
			|| /^\d+m$/i.test(token)
		) {
			return tokens.slice(0, index).join(" ") || cleanedName;
		}
	}
	return tokens.join(" ") || cleanedName;
}

export function getAdminSportAssignmentGroups() {
	const groups = new Map();
	state.sportsData.forEach(sport => {
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

export function getAssignedSportOptions(account) {
	const assignedSportId = getAssignedSportId(account);
	const assignedSportName = getAssignedSportName(account);
	const isOverallCommittee = isOverallCommitteeAssignment(account);
	const hasAssignedSportInList = assignedSportId && state.sportsData.some(sport => String(sport.id) === assignedSportId);
	const groupedSports = getAdminSportAssignmentGroups();
	const assignedGroupKey = normalizeSportGroupKey(getGeneralSportName(assignedSportName));
	const options = [
		`<option value="">No game assigned</option>`,
		`<option value="${OVERALL_COMMITTEE_SPORT_ID}" ${isOverallCommittee ? "selected" : ""}>${OVERALL_COMMITTEE_SPORT_NAME}</option>`
	];
	if (assignedSportId && !isOverallCommittee && !hasAssignedSportInList) {
		options.push(`<option value="${escapeHTML(assignedSportId)}" selected>${escapeHTML(assignedSportName || "Assigned game")}</option>`);
	}
	groupedSports.forEach(sport => {
		const sportId = String(sport.id);
		const isSelected = assignedGroupKey && normalizeSportGroupKey(sport.sport_name) === assignedGroupKey;
		options.push(`
		<option value="${escapeHTML(sportId)}" ${isSelected ? "selected" : ""}>
		${escapeHTML(sport.sport_name || "Unnamed sport")}
		</option>
		`);
	});
	return options.join("");
}

// --- Contact display ---------------------------------------------------------
export function getAdminContactDisplayName(profile) {
	return profile?.full_name || profile?.fullName || profile?.name || profile?.email || "Account";
}

export function getAdminContactSportName(profile) {
	if (normalizeComparableValue(profile?.role) === "admin") {
		return profile?.assigned_sport_name || profile?.sport_name || profile?.sport || "Administration";
	}
	return profile?.assigned_sport_name || profile?.sport_name || profile?.sport || "Unassigned";
}

export function getAdminContactSportGroupKey(profile) {
	if (!profile || normalizeComparableValue(profile.role) !== "committee") {
		return "";
	}
	const assignedSportId = String(profile.assigned_sport_id || profile.assigned_game_id || profile.sport_id || "").trim();
	const assignedSport = state.sportsData.find(sport => String(sport.id) === assignedSportId);
	const assignedSportName = assignedSport?.sport_name || getAdminContactSportName(profile);
	return normalizeSportGroupKey(getGeneralSportName(assignedSportName));
}

export function getAdminContactPhone(profile) {
	return String(profile?.contact_phone || profile?.mobile_number || profile?.mobileNumber || profile?.phone_number || profile?.phone || profile?.contact_number || "").trim();
}

export function getInitials(name) {
	return String(name || "?")
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map(part => part.charAt(0).toUpperCase())
		.join("") || "?";
}

export function getRoleBadgeClass(role) {
	return normalizeComparableValue(role) === "admin"
		? "bg-blue-100 text-blue-700"
		: "bg-yellow-100 text-yellow-800";
}

// --- Participant status ------------------------------------------------------
export function normalizeParticipantStatus(status) {
	return normalizeComparableValue(status || "pending");
}

export function getParticipantStatusLabel(status) {
	const normalizedStatus = normalizeParticipantStatus(status);
	if (normalizedStatus === "approved") return "Approved";
	if (normalizedStatus === "rejected") return "Rejected";
	return "Pending";
}

export function getParticipantStatusClass(status) {
	const normalizedStatus = normalizeParticipantStatus(status);
	if (normalizedStatus === "approved") {
		return "bg-green-100 text-green-800";
	}
	if (normalizedStatus === "pending") {
		return "bg-yellow-100 text-yellow-800";
	}
	return "bg-red-100 text-red-800";
}

// --- Sport type --------------------------------------------------------------
export function normalizeGameType(value) {
	const normalized = String(value || "").trim().toLowerCase();
	return normalized === "minor" ? "minor" : "major";
}

export function getSportGameTypeLabel(value) {
	return normalizeGameType(value) === "minor" ? "Minor Game" : "Major Game";
}

export function getSportPlayerLimit(sport) {
	const limit = Number(sport?.player_limit ?? sport?.players_per_team ?? sport?.max_players_per_team ?? 0);
	return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}

// Announcement change-detection key, shared by the overview announcements
// loader and the chat notification panel. Moved here to avoid an
// overview <-> chat import cycle.
export function getCommitteeAnnouncementChangeKey(announcement) {
	return [
		announcement?.id,
		announcement?.title || "",
		announcement?.message || ""
	].map(value => String(value ?? "")).join("|");
}
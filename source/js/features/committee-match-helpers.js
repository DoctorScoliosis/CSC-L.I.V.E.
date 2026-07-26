/*
 * Shared helpers + ownership/permission logic for the Committee matches
 * feature.
 *
 * Pure functions only — no data loading, no rendering. Imported by the
 * basketball sheet, basketball actions, match data, and matches modules,
 * so it must not import any of them (that would create a cycle).
 */

import {
	state,
	supabase,
	MATCHES_TABLE,
	normalizeComparableValue
} from "../pages/committee-context.js";

export const MATCH_PERMISSION_MESSAGE = "You do not have permission to manage this match.";

// --- Team / sport getters ----------------------------------------------------
export function getTeamName(match, teamSide) {
	if (teamSide === "one") {
		return match.team_one?.team || match.team_one_name || "Unknown Team";
	}
	return match.team_two?.team || match.team_two_name || "Unknown Team";
}

export function getTeamId(match, teamSide) {
	return teamSide === "one"
		? Number(match.team_one_id)
		: Number(match.team_two_id);
}

export function getSportName(match) {
	return match.sport?.sport_name || match.sport_name || "Unknown Sport";
}

export function normalizeSportName(value) {
	return String(value || "").trim().toLowerCase();
}

export function normalizeTeamValue(value) {
	return String(value || "").trim().toLowerCase();
}

export function getParticipantDisplayName(participant) {
	return participant?.name
		|| participant?.full_name
		|| participant?.participant_name
		|| participant?.student_name
		|| "";
}

// --- Score-sheet sport predicates --------------------------------------------
export function isBasketballSport(matchOrName) {
	const sportName = typeof matchOrName === "string" ? matchOrName : getSportName(matchOrName);
	return normalizeSportName(sportName).includes("basketball");
}

export function isVolleyballSport(matchOrName) {
	const sportName = typeof matchOrName === "string" ? matchOrName : getSportName(matchOrName);
	return normalizeSportName(sportName).includes("volleyball");
}

export function hasPlayerScoreSheet(matchOrName) {
	return isBasketballSport(matchOrName) || isVolleyballSport(matchOrName);
}

export function getScoreSheetPeriodLimit(matchOrName) {
	return isVolleyballSport(matchOrName) ? 5 : 4;
}

export function getScoreSheetPeriodLabel(matchOrName) {
	return isVolleyballSport(matchOrName) ? "Set" : "Quarter";
}

export function getScoreSheetFaultLabel(matchOrName) {
	return isVolleyballSport(matchOrName) ? "FLT" : "FLS";
}

export function getMatchStageLabel(stage) {
	if (!String(stage || "").trim()) {
		return "Elimination Round";
	}
	return {
		regular: "Elimination Round",
		semifinals: "Semifinals",
		finals: "Finals",
		battle_for_third: "Battle for Third"
	}[stage] || "";
}

export function getRoleLabel(roleValue) {
	const normalizedRole = normalizeComparableValue(roleValue);
	if (normalizedRole === "admin") {
		return "Admin";
	}
	if (normalizedRole === "committee") {
		return "Committee";
	}
	return roleValue || "Unknown Role";
}

// --- Ownership + permissions -------------------------------------------------
export function isCurrentUserAdmin() {
	return normalizeComparableValue(state.currentUser?.role) === "admin";
}

export function isMatchOwner(match) {
	if (!match || !state.currentUser) {
		return false;
	}
	const creatorValue = normalizeComparableValue(match.created_by);
	const currentUserValues = [
		state.currentUser.id,
		state.currentUser.email
	]
		.map(normalizeComparableValue)
		.filter(Boolean);
	return Boolean(creatorValue && currentUserValues.includes(creatorValue));
}

export function canManageMatch(match) {
	return isCurrentUserAdmin() || isMatchOwner(match);
}

export function showPermissionDenied() {
	alert(MATCH_PERMISSION_MESSAGE);
}

export function enforceMatchPermission(match) {
	if (canManageMatch(match)) {
		return true;
	}
	showPermissionDenied();
	return false;
}

export function applyOwnershipFilter(query) {
	if (isCurrentUserAdmin()) {
		return query;
	}
	const creatorKeys = [
		state.currentUser?.id,
		state.currentUser?.email
	]
		.map(value => String(value || "").trim())
		.filter(Boolean);
	if (creatorKeys.length === 0) {
		return query.eq("created_by", "__missing_logged_in_user__");
	}
	return query.in("created_by", creatorKeys);
}

export async function updateMatchRecord(matchId, updatePayload, options = {}) {
	let query = supabase
		.from(MATCHES_TABLE)
		.update(updatePayload)
		.eq("id", matchId);
	if (options.status) {
		query = query.eq("status", options.status);
	}
	query = applyOwnershipFilter(query);
	const { data, error } = await query
		.select("id")
		.maybeSingle();
	if (error) {
		throw error;
	}
	if (!data) {
		throw new Error(MATCH_PERMISSION_MESSAGE);
	}
	return data;
}

export async function deleteMatchRecord(matchId) {
	let query = supabase
		.from(MATCHES_TABLE)
		.delete()
		.eq("id", matchId);
	query = applyOwnershipFilter(query);
	const { data, error } = await query
		.select("id")
		.maybeSingle();
	if (error) {
		throw error;
	}
	if (!data) {
		throw new Error(MATCH_PERMISSION_MESSAGE);
	}
	return data;
}

export async function requestMatchDeleteApproval(match) {
	const requestPayload = {
		delete_requested: true,
		delete_requested_at: new Date().toISOString(),
		delete_requested_by: String(state.currentUser?.id || state.currentUser?.email || "").trim(),
		delete_requested_by_name: state.currentUser?.fullName || state.currentUser?.email || "Committee",
		delete_approved: false,
		delete_rejected: false,
		delete_rejected_at: null,
		delete_rejected_by: null
	};
	return updateMatchRecord(match.id, requestPayload);
}

export function buildMatchOwnerLine(match, canManage) {
	const creatorName = match.created_by_name || match.created_by || "Unassigned match";
	const creatorRole = match.created_by_role ? ` • ${getRoleLabel(match.created_by_role)}` : "";
	const accessText = isCurrentUserAdmin()
		? "Admin full access"
		: canManage
		? "You created this match"
		: "View only";
	return `${escapeForOwnerLine(creatorName)}${escapeForOwnerLine(creatorRole)} • ${escapeForOwnerLine(accessText)}`;
}

// Local escape to avoid importing the DOM util cycle-free.
function escapeForOwnerLine(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

// --- Sport visibility for scheduling -----------------------------------------
export function normalizeSportText(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeSportCompact(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

export function canCurrentUserScheduleAllSports() {
	return isCurrentUserAdmin()
		|| state.currentUser?.assignedSportId === "__overall_committee__"
		|| normalizeSportText(state.currentUser?.assignedSportName) === normalizeSportText("Overall Committee");
}

export function isSportVisibleForCurrentUser(sport) {
	if (canCurrentUserScheduleAllSports()) {
		return true;
	}
	const assignedSportId = String(state.currentUser?.assignedSportId || "").trim();
	const assignedSportName = normalizeSportText(state.currentUser?.assignedSportName);
	const assignedSportCompact = normalizeSportCompact(state.currentUser?.assignedSportName);
	const sportId = String(sport?.id || "").trim();
	const sportName = normalizeSportText(sport?.sport_name || sport?.name || "");
	const sportCompact = normalizeSportCompact(sport?.sport_name || sport?.name || "");
	if (assignedSportId && sportId && assignedSportId === sportId) {
		return true;
	}
	if ((!assignedSportName || !sportName) && (!assignedSportCompact || !sportCompact)) {
		return false;
	}
	return sportName.includes(assignedSportName)
		|| assignedSportName.includes(sportName)
		|| sportCompact.includes(assignedSportCompact)
		|| assignedSportCompact.includes(sportCompact);
}
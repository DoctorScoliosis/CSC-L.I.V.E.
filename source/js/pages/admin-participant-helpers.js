/*
 * Shared participant filtering + registration slot helpers for the Admin
 * dashboard.
 *
 * Used by BOTH the Games tab (to show available slots per sport) and the
 * Participants tab (to filter the list). Keeping them here breaks what would
 * otherwise be a circular dependency between admin-sports.js and
 * admin-participants.js.
 */

import { state, TEAM_NAME_COLUMN } from "./admin-context.js";
import { getSportPlayerLimit, normalizeParticipantStatus } from "./admin-helpers.js";

export function normalizeParticipantTeam(team) {
	return String(team || "").trim();
}

export function getParticipantTeamName(participant) {
	return participant.team_name || participant.team || "-";
}

export function getParticipantMajorSportName(participant) {
	return participant.major_sport_name || participant.major_game_name || participant.selected_major_sport || "-";
}

export function getParticipantMinorSportName(participant) {
	return participant.minor_sport_name || participant.minor_game_name || participant.selected_minor_sport || "-";
}

export function normalizeParticipantSport(value) {
	return String(value || "").trim();
}

export function splitParticipantSportNames(value) {
	return String(value || "")
		.split(",")
		.map(name => normalizeParticipantSport(name))
		.filter(name => name && name !== "-");
}

export function splitSportIdValues(value) {
	return String(value || "")
		.split(",")
		.map(item => item.trim())
		.filter(Boolean);
}

export function participantIncludesSport(participant, sport) {
	const sportId = String(sport?.id || "");
	const sportName = normalizeParticipantSport(sport?.sport_name || sport?.name || sport?.game_name).toLowerCase();
	const sportIds = [
		...splitSportIdValues(participant.major_sport_id),
		...splitSportIdValues(participant.minor_sport_id)
	];
	if (sportId && sportIds.includes(sportId)) {
		return true;
	}
	const sportNames = [
		getParticipantMajorSportName(participant),
		getParticipantMinorSportName(participant)
	].flatMap(splitParticipantSportNames).map(name => name.toLowerCase());
	return Boolean(sportName && sportNames.includes(sportName));
}

export function isCountedRegistrationStatus(status) {
	return normalizeParticipantStatus(status) !== "rejected";
}

export function getParticipantSlotTeamKey(participant) {
	return String(participant.team_id || normalizeParticipantTeam(getParticipantTeamName(participant))).trim().toLowerCase();
}

export function countParticipantsForSportTeam(sport, team) {
	const teamId = String(team?.id || "").trim().toLowerCase();
	const teamName = normalizeParticipantTeam(team?.[TEAM_NAME_COLUMN] || team?.team || team?.name).toLowerCase();
	return state.participantsData.filter(participant => {
		if (!isCountedRegistrationStatus(participant.status) || !participantIncludesSport(participant, sport)) {
			return false;
		}
		const participantTeamId = String(participant.team_id || "").trim().toLowerCase();
		const participantTeamName = normalizeParticipantTeam(getParticipantTeamName(participant)).toLowerCase();
		return Boolean((teamId && participantTeamId === teamId) || (teamName && participantTeamName === teamName));
	}).length;
}

export function getSportTotalAvailableSlots(sport) {
	const limit = getSportPlayerLimit(sport);
	if (!limit || !state.teamsData.length) {
		return null;
	}
	return state.teamsData.reduce((total, team) => {
		const used = countParticipantsForSportTeam(sport, team);
		return total + Math.max(limit - used, 0);
	}, 0);
}

// --- Participant field getters -----------------------------------------------
// Pure accessors over a participant row. Used by the participants list, the
// add/edit form, the details modal, and the print reports.
export function getParticipantDisplayName(participant) {
	return participant.full_name || participant.name || "Unnamed participant";
}

export function getParticipantCourse(participant) {
	return participant.course || "-";
}

export function getParticipantAge(participant) {
	return participant.age ?? "-";
}

export function getParticipantIdNumber(participant) {
	return participant.id_number || participant.student_id || "-";
}

export function getParticipantHomeCollege(participant) {
	return participant.home_college || participant.home_college_name || participant.homeCollege || getParticipantTeamName(participant);
}

export function getParticipantImportCollege(participant) {
	return participant.import_college || participant.import_college_name || participant.importCollege || (isParticipantImport(participant) ? getParticipantTeamName(participant) : "-");
}

export function getParticipantGameScope(participant) {
	return participant.game_scope || participant.play_scope || participant.playing_in || "";
}

export function getParticipantGameScopeLabel(participant) {
	const scope = String(getParticipantGameScope(participant)).trim().toLowerCase();
	if (scope === "major") return "Major Game Only";
	if (scope === "minor") return "Minor Game Only";
	if (scope === "both") return "Both Major and Minor Game";
	return "-";
}

export function isParticipantImport(participant) {
	const value = participant.is_import ?? participant.import_player ?? participant.isImport;
	if (typeof value === "boolean") {
		return value;
	}
	return ["true", "yes", "1", "import"].includes(String(value || "").trim().toLowerCase());
}

export function getParticipantPhotoUrls(participant, key) {
	const value = participant[key];
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.filter(Boolean);
	}
	if (typeof value === "object") {
		return Object.values(value).filter(Boolean);
	}
	const rawValue = String(value).trim();
	if (!rawValue) {
		return [];
	}
	if (rawValue.startsWith("{") || rawValue.startsWith("[")) {
		try {
			const parsed = JSON.parse(rawValue);
			if (Array.isArray(parsed)) {
				return parsed.filter(Boolean);
			}
			if (parsed && typeof parsed === "object") {
				return Object.values(parsed).filter(Boolean);
			}
		} catch (error) {
			console.warn("Unable to parse participant document URLs:", error);
		}
	}
	return [rawValue];
}
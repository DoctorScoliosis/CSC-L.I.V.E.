/*
 * Add / Edit Participant form for the Admin dashboard.
 *
 * Owns the participant modal end-to-end:
 *   - opening for add vs. edit and prefilling every field
 *   - populating the home-college / team-to-join / import-college selects
 *     from the registered teams
 *   - the import-player visibility toggle
 *   - normalising the "Playing In" game scope
 *   - resolving major/minor sport names to sport IDs for save
 *
 * admin-participants.js imports the modal open/close and the save helpers
 * (getSelectedTeamId, normalizeParticipantGameScopeValue,
 * getParticipantSportIdForSave) from here. The orchestrator wires the
 * open/close/cancel buttons and the import checkbox in 3.5.5.
 *
 * NOTE: getTeamName(team) here takes a team ROW from teamsData — it is NOT
 * the same as the match-rendering getTeamName(match, teamSide) that lives in
 * the matches module. Same name, different signature, different module.
 */

import { state, dom, TEAM_NAME_COLUMN } from "../pages/admin-context.js";
import {
	getParticipantDisplayName,
	getParticipantIdNumber,
	getParticipantCourse,
	getParticipantAge,
	getParticipantHomeCollege,
	getParticipantTeamName,
	getParticipantImportCollege,
	isParticipantImport,
	getParticipantGameScope,
	getParticipantMajorSportName,
	getParticipantMinorSportName,
	normalizeParticipantStatus,
	getParticipantStatusLabel,
	normalizeParticipantTeam,
	splitParticipantSportNames,
	normalizeParticipantSport
} from "../pages/admin-participant-helpers.js";
import { normalizeGameType } from "../pages/admin-helpers.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTimeLocalInput } from "../utils/datetime.js";

// --- Team select helpers -----------------------------------------------------
function getTeamName(team) {
	return normalizeParticipantTeam(team?.[TEAM_NAME_COLUMN] || team?.team || team?.name);
}

function getTeamIdByName(teamName) {
	const normalizedTeamName = normalizeParticipantTeam(teamName).toLowerCase();
	const team = state.teamsData.find(teamRow => getTeamName(teamRow).toLowerCase() === normalizedTeamName);
	return team?.id || null;
}

export function getSelectedTeamId(select) {
	const selectedOption = select?.options?.[select.selectedIndex];
	return selectedOption?.dataset?.teamId || getTeamIdByName(select?.value || "");
}

function setTeamSelectOptions(select, selectedTeam, placeholder = "Select a registered team") {
	if (!select) return;
	const normalizedSelectedTeam = normalizeParticipantTeam(selectedTeam);
	const registeredTeams = [...new Set(
		state.teamsData
			.map(getTeamName)
			.filter(Boolean)
	)].sort((a, b) => a.localeCompare(b));
	select.innerHTML = `
	<option value="">${registeredTeams.length ? placeholder : "No registered teams available"}</option>
	${registeredTeams.map(teamName => {
		const teamId = getTeamIdByName(teamName) || "";
		return `<option value="${escapeHTML(teamName)}" data-team-id="${escapeHTML(teamId)}">${escapeHTML(teamName)}</option>`;
	}).join("")}
	${normalizedSelectedTeam && !registeredTeams.includes(normalizedSelectedTeam) ? `<option value="${escapeHTML(normalizedSelectedTeam)}">${escapeHTML(normalizedSelectedTeam)}</option>` : ""}
	`;
	if (normalizedSelectedTeam) {
		select.value = normalizedSelectedTeam;
	}
}

export function renderParticipantTeamOptions(selected = {}) {
	const selectedTeam = typeof selected === "string" ? selected : selected.team;
	const selectedHomeCollege = typeof selected === "object" ? selected.homeCollege : dom.participantHomeCollege.value;
	const selectedImportCollege = typeof selected === "object" ? selected.importCollege : dom.participantImportCollege.value;
	setTeamSelectOptions(dom.participantHomeCollege, selectedHomeCollege ?? dom.participantHomeCollege.value, "Select home college");
	setTeamSelectOptions(dom.participantTeam, selectedTeam ?? dom.participantTeam.value, "Select team to join");
	setTeamSelectOptions(dom.participantImportCollege, selectedImportCollege ?? dom.participantImportCollege.value, "Select import college");
}

export function updateParticipantImportEditVisibility() {
	const isImport = dom.participantIsImport.checked;
	dom.participantImportCollegeGroup.classList.toggle("hidden", !isImport);
	dom.participantImportCollege.required = isImport;
	if (!isImport) {
		dom.participantImportCollege.value = "";
	}
}

// --- Game scope + sport ID resolution ----------------------------------------
export function normalizeParticipantGameScopeValue(value) {
	const normalizedValue = String(value || "").trim().toLowerCase();
	if (normalizedValue === "major" || normalizedValue === "minor" || normalizedValue === "both") {
		return normalizedValue;
	}
	return null;
}

function resolveParticipantSportIds(sportNames, type) {
	const names = splitParticipantSportNames(sportNames).map(name => name.toLowerCase());
	if (!names.length) {
		return null;
	}
	const matchingIds = state.sportsData
		.filter(sport => normalizeGameType(sport.game_type || sport.sport_type || sport.category_type) === type)
		.filter(sport => names.includes(normalizeParticipantSport(sport.sport_name || sport.name || sport.game_name).toLowerCase()))
		.map(sport => sport.id)
		.filter(Boolean);
	return matchingIds.length ? matchingIds.join(",") : null;
}

export function getParticipantSportIdForSave(fieldName, sportNames, type) {
	const existingValue = state.activeParticipantEditRecord?.[fieldName] || null;
	const previousNames = type === "major"
		? getParticipantMajorSportName(state.activeParticipantEditRecord || {})
		: getParticipantMinorSportName(state.activeParticipantEditRecord || {});
	if (normalizeParticipantSport(sportNames) === normalizeParticipantSport(previousNames)) {
		return existingValue;
	}
	return resolveParticipantSportIds(sportNames, type);
}

// --- Modal open / close ------------------------------------------------------
export function openAddParticipantModal() {
	dom.participantModalTitle.textContent = "Add Participant";
	dom.participantForm.reset();
	state.activeParticipantEditRecord = null;
	dom.participantId.value = "";
	dom.participantStatus.value = "Pending";
	dom.participantGameScope.value = "";
	dom.participantCreatedAt.value = "";
	dom.participantReviewedAt.value = "";
	renderParticipantTeamOptions();
	updateParticipantImportEditVisibility();
	dom.participantModal.classList.remove("hidden");
	dom.participantModal.classList.add("flex");
}

export function openEditParticipantModal(participant) {
	dom.participantModalTitle.textContent = "Edit Participant";
	state.activeParticipantEditRecord = participant;
	dom.participantId.value = participant.id;
	dom.participantName.value = getParticipantDisplayName(participant) === "Unnamed participant" ? "" : getParticipantDisplayName(participant);
	dom.participantStudentId.value = getParticipantIdNumber(participant) === "-" ? "" : getParticipantIdNumber(participant);
	dom.participantCourse.value = getParticipantCourse(participant) === "-" ? "" : getParticipantCourse(participant);
	dom.participantAge.value = getParticipantAge(participant) === "-" ? "" : getParticipantAge(participant);
	dom.participantIsImport.checked = isParticipantImport(participant);
	dom.participantGameScope.value = getParticipantGameScope(participant) || "";
	dom.participantMajorSportName.value = getParticipantMajorSportName(participant) === "-" ? "" : getParticipantMajorSportName(participant);
	dom.participantMinorSportName.value = getParticipantMinorSportName(participant) === "-" ? "" : getParticipantMinorSportName(participant);
	dom.participantCreatedAt.value = formatDateTimeLocalInput(participant.created_at);
	dom.participantStatus.value = getParticipantStatusLabel(participant.status);
	dom.participantReviewedByName.value = participant.reviewed_by_name || "";
	dom.participantReviewedAt.value = formatDateTimeLocalInput(participant.reviewed_at);
	dom.participantRejectionReasonEdit.value = participant.rejection_reason || "";
	renderParticipantTeamOptions({
		homeCollege: getParticipantHomeCollege(participant) === "-" ? "" : getParticipantHomeCollege(participant),
		team: getParticipantTeamName(participant) === "-" ? "" : getParticipantTeamName(participant),
		importCollege: getParticipantImportCollege(participant) === "-" ? "" : getParticipantImportCollege(participant)
	});
	updateParticipantImportEditVisibility();
	dom.participantModal.classList.remove("hidden");
	dom.participantModal.classList.add("flex");
}

export function closeParticipantModalFunction() {
	dom.participantModal.classList.add("hidden");
	dom.participantModal.classList.remove("flex");
	dom.participantForm.reset();
	dom.participantId.value = "";
	state.activeParticipantEditRecord = null;
}
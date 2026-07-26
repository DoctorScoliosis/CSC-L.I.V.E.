/*
 * College / team loading and selection helpers for the CSC Cup
 * registration page.
 *
 * Loads the team list from Supabase, renders the home-college and
 * import-college <select> options, and provides the small helpers that
 * other feature modules use to read the current selection
 * (getHomeCollegeSelection, isFacultySelection, etc.).
 */

import { supabase, state, dom } from "../pages/registration-context.js";
import { TEAMS_TABLE } from "../config.js";
import { escapeHTML } from "../utils/dom.js";
import { normalizeSportGroupKey } from "../utils/normalize.js";
import { setAlert } from "./registration-ui.js";

export async function loadTeams() {
	const { data, error } = await supabase
		.from(TEAMS_TABLE)
		.select("id, team")
		.order("team", { ascending: true });
	if (error) {
		console.error("Team load error:", error);
		dom.teamSelect.innerHTML = `<option value="">Unable to load colleges</option>`;
		dom.importCollegeSelect.innerHTML = `<option value="">Unable to load colleges</option>`;
		setAlert("Unable to load colleges. Please refresh the page or contact the CSC admin.");
		return;
	}
	state.teamsData = data || [];
	renderCollegeOptions();
}

export function renderCollegeOptions() {
	const selectedHomeCollegeId = getSelectedOptionValue(dom.teamSelect);
	const selectedImportCollegeId = getSelectedOptionValue(dom.importCollegeSelect);
	const optionsMarkup = state.teamsData.map(team => `<option value="${String(team.id)}" data-name="${escapeHTML(team.team || "")}">${escapeHTML(team.team || "Unnamed college")}</option>`).join("");
	const importOptionsMarkup = state.teamsData
		.filter(team => String(team.id) !== String(selectedHomeCollegeId))
		.map(team => `<option value="${String(team.id)}" data-name="${escapeHTML(team.team || "")}">${escapeHTML(team.team || "Unnamed college")}</option>`)
		.join("");
	dom.teamSelect.innerHTML = `
	<option value="">Select your home college</option>
	${optionsMarkup}
	`;
	if (selectedHomeCollegeId && state.teamsData.some(team => String(team.id) === String(selectedHomeCollegeId))) {
		dom.teamSelect.value = selectedHomeCollegeId;
	}
	dom.importCollegeSelect.innerHTML = `
	<option value="">Select the team to join</option>
	${importOptionsMarkup}
	`;
	if (selectedImportCollegeId && selectedImportCollegeId !== selectedHomeCollegeId && state.teamsData.some(team => String(team.id) === String(selectedImportCollegeId))) {
		dom.importCollegeSelect.value = selectedImportCollegeId;
	}
}

export function getSelectedOptionName(select) {
	if (!getSelectedOptionValue(select)) {
		return "";
	}
	const selectedOption = select?.options?.[select.selectedIndex];
	return selectedOption?.dataset?.name || selectedOption?.textContent || "";
}

export function getSelectedOptionValue(select) {
	return select?.value || "";
}

export function getPlayableCollegeSelection(isImport) {
	const select = isImport ? dom.importCollegeSelect : dom.teamSelect;
	return {
		id: getSelectedOptionValue(select),
		name: getSelectedOptionName(select)
	};
}

export function getHomeCollegeSelection() {
	return {
		id: getSelectedOptionValue(dom.teamSelect),
		name: getSelectedOptionName(dom.teamSelect)
	};
}

export function getCurrentPlayableCollegeSelection() {
	return getPlayableCollegeSelection(dom.isImportCheckbox.checked);
}

export function hasCurrentPlayableCollegeSelection() {
	const playableCollege = getCurrentPlayableCollegeSelection();
	return Boolean(playableCollege.id);
}

export function isFacultySelection() {
	const homeCollege = getHomeCollegeSelection();
	return normalizeSportGroupKey(homeCollege.name) === "faculty";
}
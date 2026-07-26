/*
 * Sport selection, slot availability, and visibility logic for the CSC Cup
 * registration page.
 *
 * This is the largest registration feature module. It owns:
 *   - rendering the major/minor sport checkboxes from the sports table
 *   - per-college slot availability (registration_slot_counts view)
 *   - the selection rules (1 major, or 2 as 1-indoor+1-outdoor / 2-outdoor;
 *     1–2 minors; singles/doubles and gender/mixed conflicts)
 *   - the game-scope and import-form visibility toggles
 *   - the submit-button availability check (isRegistrationReadyToSubmit)
 *
 * It imports college helpers from registration-colleges.js and camera
 * helpers from camera-capture.js. No circular dependencies.
 */

import {
	supabase,
	state,
	dom,
	MAJOR_ONLY_LIMIT,
	MINOR_MIN,
	MINOR_LIMIT,
	MINOR_WITH_MAJOR_LIMIT,
	MAJOR_SELECTION_RULE_MESSAGE
} from "../pages/registration-context.js";
import { SPORTS_TABLE, REGISTRATION_SLOT_COUNTS_VIEW } from "../config.js";
import { escapeHTML } from "../utils/dom.js";
import { normalizeGameType, normalizeSportGroupKey, splitSportIdValues } from "../utils/normalize.js";
import { getSportPlayerLimit } from "../utils/sports.js";
import { openRuleNoticeModal } from "./registration-ui.js";
import {
	getCurrentPlayableCollegeSelection,
	hasCurrentPlayableCollegeSelection,
	isFacultySelection,
	renderCollegeOptions
} from "./registration-colleges.js";
import { hasCameraCapture, resetCameraCapture } from "./camera-capture.js";

// --- Sport name helpers ------------------------------------------------------
function getSportName(sport) {
	return sport?.sport_name || sport?.name || sport?.game_name || "Unnamed game";
}

// --- Slot availability -------------------------------------------------------
function getSlotCountForSportCollege(sportId, college) {
	const normalizedSportId = String(sportId || "");
	const normalizedCollegeId = String(college?.id || "");
	const normalizedCollegeName = normalizeSportGroupKey(college?.name || "");
	const row = state.registrationSlotCounts.find(item => {
		const rowSportId = String(item.sport_id || item.sportId || "");
		const rowTeamId = String(item.team_id || item.teamId || "");
		const rowTeamName = normalizeSportGroupKey(item.team_name || item.team || item.college_name || "");
		return rowSportId === normalizedSportId
			&& ((normalizedCollegeId && rowTeamId === normalizedCollegeId) || (normalizedCollegeName && rowTeamName === normalizedCollegeName));
	});
	return Number(row?.registered_count ?? row?.count ?? 0) || 0;
}

function getRemainingSlotsForSportIds(sportIds, college = getCurrentPlayableCollegeSelection()) {
	const ids = splitSportIdValues(sportIds);
	if (!college?.id) {
		return { remaining: 0, needsCollege: true, hasLimit: true };
	}
	const remainingValues = ids
		.map(id => {
			const sport = state.sportsData.find(item => String(item.id) === String(id));
			const limit = getSportPlayerLimit(sport);
			if (!sport || !limit) {
				return null;
			}
			const used = getSlotCountForSportCollege(id, college);
			return Math.max(limit - used, 0);
		})
		.filter(value => value !== null);
	if (!remainingValues.length) {
		return { remaining: Infinity, needsCollege: false, hasLimit: false };
	}
	return {
		remaining: Math.min(...remainingValues),
		needsCollege: false,
		hasLimit: true
	};
}

function getSportSlotNote(value) {
	if (state.isSyncingSportSlots) {
		return "Checking available slots...";
	}
	const availability = getRemainingSlotsForSportIds(value);
	if (availability.needsCollege) {
		return "Select your college first to check available slots";
	}
	if (!availability.hasLimit) {
		return "No player limit set yet";
	}
	return availability.remaining > 0
		? `${availability.remaining} slot${availability.remaining === 1 ? "" : "s"} left for your college`
		: "No slots left for your college";
}

// --- Category conflict helpers -----------------------------------------------
function getSinglesDoublesCategory(label) {
	const normalizedLabel = String(label || "").toLowerCase();
	if (/\bsingles?\b/.test(normalizedLabel)) {
		return "singles";
	}
	if (/\bdoubles?\b/.test(normalizedLabel)) {
		return "doubles";
	}
	return "";
}

function getSinglesDoublesGroupKey(label) {
	const category = getSinglesDoublesCategory(label);
	if (!category) {
		return "";
	}
	return normalizeSportGroupKey(
		String(label || "")
			.replace(/\bsingles?\b/gi, "")
			.replace(/\bdoubles?\b/gi, "")
			.replace(/\bmen'?s\b|\bwomen'?s\b|\bmixed\b|\bboys?\b|\bgirls?\b/gi, "")
	);
}

function getGenderMixedCategory(label) {
	const normalizedLabel = String(label || "").toLowerCase();
	if (/\bmixed\s+doubles?\b/.test(normalizedLabel)) {
		return "mixed doubles";
	}
	if (/\bboys?\b/.test(normalizedLabel)) {
		return "boys";
	}
	if (/\bgirls?\b/.test(normalizedLabel)) {
		return "girls";
	}
	return "";
}

function getGenderMixedGroupKey(label) {
	const category = getGenderMixedCategory(label);
	if (!category) {
		return "";
	}
	return normalizeSportGroupKey(
		String(label || "")
			.replace(/\bsingles?\b/gi, "")
			.replace(/\bdoubles?\b/gi, "")
			.replace(/\bmen'?s\b|\bwomen'?s\b|\bmixed\b|\bboys?\b|\bgirls?\b/gi, "")
	);
}

function inferMajorSportVenue(sport) {
	const sportKey = normalizeSportGroupKey(getSportName(sport));
	if (sportKey.includes("frisbee") || sportKey.includes("softball")) {
		return "outdoor";
	}
	return "indoor";
}

// --- Checkbox rendering ------------------------------------------------------
function renderSportCheckbox(container, sport, name) {
	const singlesDoublesCategory = getSinglesDoublesCategory(sport.label);
	const singlesDoublesGroup = getSinglesDoublesGroupKey(sport.label);
	const genderMixedCategory = getGenderMixedCategory(sport.label);
	const genderMixedGroup = getGenderMixedGroupKey(sport.label);
	const availability = getRemainingSlotsForSportIds(sport.value);
	const isUnavailable = state.isSyncingSportSlots || availability.needsCollege || (availability.hasLimit && availability.remaining <= 0);
	return `
	<label class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
	<input
	type="checkbox"
	name="${name}"
	value="${escapeHTML(sport.value)}"
	data-name="${escapeHTML(sport.label)}"
	data-venue="${escapeHTML(sport.venue || "")}"
	data-singles-doubles-category="${escapeHTML(singlesDoublesCategory)}"
	data-singles-doubles-group="${escapeHTML(singlesDoublesGroup)}"
	data-gender-mixed-category="${escapeHTML(genderMixedCategory)}"
	data-gender-mixed-group="${escapeHTML(genderMixedGroup)}"
	data-slot-remaining="${availability.remaining === Infinity ? "" : escapeHTML(availability.remaining)}"
	data-slot-needs-college="${availability.needsCollege ? "true" : "false"}"
	data-slot-has-limit="${availability.hasLimit ? "true" : "false"}"
	${isUnavailable ? "disabled" : ""}
	class="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-500">
	<span class="min-w-0">
	<span class="block ${isUnavailable ? "text-slate-400" : ""}">${escapeHTML(sport.label)}</span>
	${sport.note ? `<span class="mt-0.5 block text-[11px] font-semibold text-slate-500">${escapeHTML(sport.note)}</span>` : ""}
	<span class="mt-0.5 block text-[11px] font-black ${availability.hasLimit && availability.remaining <= 0 ? "text-red-600" : "text-emerald-700"}">${escapeHTML(getSportSlotNote(sport.value))}</span>
	</span>
	</label>
	`;
}

export function renderSportCheckboxes() {
	const majorChoices = state.sportsData
		.filter(sport => normalizeGameType(sport.game_type || sport.sport_type || sport.category_type) === "major")
		.sort((a, b) => getSportName(a).localeCompare(getSportName(b)))
		.map(sport => ({
			value: String(sport.id),
			label: getSportName(sport),
			venue: inferMajorSportVenue(sport),
			note: "Major game"
		}));
	const minorChoices = state.sportsData
		.filter(sport => normalizeGameType(sport.game_type || sport.sport_type || sport.category_type) === "minor")
		.sort((a, b) => getSportName(a).localeCompare(getSportName(b)))
		.map(sport => ({
			value: String(sport.id),
			label: getSportName(sport),
			note: "Minor game"
		}));
	dom.majorIndoorOptions.innerHTML = majorChoices
		.filter(option => option.venue === "indoor")
		.map(option => renderSportCheckbox(dom.majorIndoorOptions, option, "majorSport"))
		.join("") || `<p class="text-xs font-semibold text-slate-500">No indoor major games listed.</p>`;
	dom.majorOutdoorOptions.innerHTML = majorChoices
		.filter(option => option.venue === "outdoor")
		.map(option => renderSportCheckbox(dom.majorOutdoorOptions, option, "majorSport"))
		.join("") || `<p class="text-xs font-semibold text-slate-500">No outdoor major games listed.</p>`;
	dom.minorSportOptions.innerHTML = minorChoices
		.map(option => renderSportCheckbox(dom.minorSportOptions, option, "minorSport"))
		.join("") || `<p class="text-xs font-semibold text-slate-500">No minor games listed yet.</p>`;
	document.querySelectorAll('input[name="majorSport"], input[name="minorSport"]').forEach(input => {
		input.addEventListener("change", event => {
			enforceSportSelectionLimits(event);
			updateSubmitAvailability();
		});
	});
	updateSubmitAvailability();
}

// --- Checked-sport readers ---------------------------------------------------
export function getCheckedSports(name) {
	return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
		.map(input => ({
			id: input.value,
			name: input.dataset.name || input.value,
			venue: input.dataset.venue || "",
			singlesDoublesCategory: input.dataset.singlesDoublesCategory || "",
			singlesDoublesGroup: input.dataset.singlesDoublesGroup || "",
			genderMixedCategory: input.dataset.genderMixedCategory || "",
			genderMixedGroup: input.dataset.genderMixedGroup || "",
			slotRemaining: input.dataset.slotRemaining || "",
			slotNeedsCollege: input.dataset.slotNeedsCollege === "true",
			slotHasLimit: input.dataset.slotHasLimit === "true"
		}));
}

export function clearCheckedSports(name) {
	document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
		input.checked = false;
	});
}

// --- Selection rule enforcement ----------------------------------------------
export function enforceSportSelectionLimits(event) {
	const target = event?.target;
	if (target?.checked) {
		const availability = getRemainingSlotsForSportIds(target.value);
		if (availability.needsCollege) {
			target.checked = false;
			openRuleNoticeModal("Please select your college first so available slots can be checked.");
			return;
		}
		if (availability.hasLimit && availability.remaining <= 0) {
			target.checked = false;
			openRuleNoticeModal(`${target.dataset.name || "This sport category"} has no available slots left for your selected college.`);
			return;
		}
	}
	if (target?.checked) {
		const category = target.dataset.singlesDoublesCategory || "";
		const group = target.dataset.singlesDoublesGroup || "";
		if (category && group) {
			const hasOppositeCategorySelected = Array.from(document.querySelectorAll('input[name="majorSport"]:checked, input[name="minorSport"]:checked'))
				.some(input => {
					return input !== target
						&& input.dataset.singlesDoublesGroup === group
						&& input.dataset.singlesDoublesCategory
						&& input.dataset.singlesDoublesCategory !== category;
				});
			if (hasOppositeCategorySelected) {
				target.checked = false;
				openRuleNoticeModal("You cannot select singles and doubles categories for the same game at the same time.");
				return;
			}
		}
	}
	if (target?.checked) {
		const category = target.dataset.genderMixedCategory || "";
		const group = target.dataset.genderMixedGroup || "";
		if (category && group) {
			const hasOtherGenderMixedCategorySelected = Array.from(document.querySelectorAll('input[name="majorSport"]:checked, input[name="minorSport"]:checked'))
				.some(input => {
					return input !== target
						&& input.dataset.genderMixedGroup === group
						&& input.dataset.genderMixedCategory
						&& input.dataset.genderMixedCategory !== category;
				});
			if (hasOtherGenderMixedCategorySelected) {
				target.checked = false;
				openRuleNoticeModal("You cannot select boys, girls, and mixed doubles categories for the same game at the same time.");
				return;
			}
		}
	}
	if (target?.name === "majorSport" && target.checked) {
		const majorLimit = MAJOR_ONLY_LIMIT;
		if (getCheckedSports("majorSport").length > majorLimit) {
			target.checked = false;
			openRuleNoticeModal(`You can select only ${majorLimit} major game${majorLimit === 1 ? "" : "s"}.`);
			return;
		}
		const selectedIndoorCount = document.querySelectorAll('input[name="majorSport"][data-venue="indoor"]:checked').length;
		const selectedOutdoorCount = document.querySelectorAll('input[name="majorSport"][data-venue="outdoor"]:checked').length;
		if (selectedIndoorCount > 1) {
			target.checked = false;
			openRuleNoticeModal("You cannot select 2 indoor major games.");
			return;
		}
		if (selectedIndoorCount > 0 && selectedOutdoorCount >= 2) {
			target.checked = false;
			openRuleNoticeModal(MAJOR_SELECTION_RULE_MESSAGE);
			return;
		}
	}
	const minorLimit = getMinorSportLimit();
	if (target?.name === "minorSport" && target.checked && getCheckedSports("minorSport").length > minorLimit) {
		target.checked = false;
		openRuleNoticeModal(`You can select only ${minorLimit} minor game${minorLimit === 1 ? "" : "s"}.`);
	}
	if (!target?.name) {
		const checkedMajorInputs = Array.from(document.querySelectorAll('input[name="majorSport"]:checked'));
		const majorLimit = MAJOR_ONLY_LIMIT;
		checkedMajorInputs.slice(majorLimit).forEach(input => {
			input.checked = false;
		});
		const checkedMinorInputs = Array.from(document.querySelectorAll('input[name="minorSport"]:checked'));
		checkedMinorInputs.slice(minorLimit).forEach(input => {
			input.checked = false;
		});
	}
}

// --- Validation predicates ---------------------------------------------------
export function hasSinglesDoublesConflict(selectedSports) {
	const selectedByGroup = new Map();
	return selectedSports.some(sport => {
		if (!sport.singlesDoublesCategory || !sport.singlesDoublesGroup) {
			return false;
		}
		const existingCategory = selectedByGroup.get(sport.singlesDoublesGroup);
		if (existingCategory && existingCategory !== sport.singlesDoublesCategory) {
			return true;
		}
		selectedByGroup.set(sport.singlesDoublesGroup, sport.singlesDoublesCategory);
		return false;
	});
}

export function hasGenderMixedConflict(selectedSports) {
	const selectedByGroup = new Map();
	return selectedSports.some(sport => {
		if (!sport.genderMixedCategory || !sport.genderMixedGroup) {
			return false;
		}
		const existingCategory = selectedByGroup.get(sport.genderMixedGroup);
		if (existingCategory && existingCategory !== sport.genderMixedCategory) {
			return true;
		}
		selectedByGroup.set(sport.genderMixedGroup, sport.genderMixedCategory);
		return false;
	});
}

export function hasSelectedSportsWithNoSlots(selectedSports) {
	return selectedSports.some(sport => {
		const availability = getRemainingSlotsForSportIds(sport.id);
		return availability.needsCollege || (availability.hasLimit && availability.remaining <= 0);
	});
}

export function hasValidMajorSportSelection(selectedMajorSports) {
	if (selectedMajorSports.length === 1) {
		return true;
	}
	const selectedIndoorMajorSports = selectedMajorSports.filter(item => item.venue === "indoor");
	const selectedOutdoorMajorSports = selectedMajorSports.filter(item => item.venue === "outdoor");
	return selectedMajorSports.length === MAJOR_ONLY_LIMIT
		&& (
			(selectedIndoorMajorSports.length === 1 && selectedOutdoorMajorSports.length === 1)
			|| (selectedIndoorMajorSports.length === 0 && selectedOutdoorMajorSports.length === 2)
		);
}

export function getMinorSportLimit(gameScope = dom.gameScopeSelect.value) {
	return gameScope === "both" ? MINOR_WITH_MAJOR_LIMIT : MINOR_LIMIT;
}

export function hasValidMinorSportSelection(selectedMinorSports, gameScope = dom.gameScopeSelect.value) {
	const minorLimit = getMinorSportLimit(gameScope);
	return selectedMinorSports.length >= MINOR_MIN && selectedMinorSports.length <= minorLimit;
}

// --- Submit availability -----------------------------------------------------
export function isRegistrationReadyToSubmit() {
	const isImport = dom.isImportCheckbox.checked;
	const isFaculty = isFacultySelection();
	const gameScope = dom.gameScopeSelect.value;
	const requiresMajor = gameScope === "major" || gameScope === "both";
	const requiresMinor = gameScope === "minor" || gameScope === "both";
	const selectedMajorSports = getCheckedSports("majorSport");
	const selectedMinorSports = getCheckedSports("minorSport");
	const selectedSports = [...selectedMajorSports, ...selectedMinorSports];
	return dom.form.checkValidity()
		&& hasCurrentPlayableCollegeSelection()
		&& !state.isSyncingSportSlots
		&& Boolean(gameScope)
		&& (isFacultySelection() || hasCameraCapture("parentPage1"))
		&& (isFacultySelection() || hasCameraCapture("parentPage2"))
		&& (isFacultySelection() || hasCameraCapture("medical"))
		&& (!isImport || Boolean(dom.importCollegeSelect.value))
		&& (isFacultySelection() || !isImport || (hasCameraCapture("importFormPage1") && hasCameraCapture("importFormPage2")))
		&& (!requiresMajor || hasValidMajorSportSelection(selectedMajorSports))
		&& (!requiresMinor || hasValidMinorSportSelection(selectedMinorSports, gameScope))
		&& !hasSinglesDoublesConflict(selectedSports)
		&& !hasGenderMixedConflict(selectedSports)
		&& !hasSelectedSportsWithNoSlots(selectedSports);
}

export function updateSubmitAvailability() {
	if (state.isSubmittingRegistration) {
		return;
	}
	dom.submitButton.disabled = !isRegistrationReadyToSubmit();
}

export function joinSelectionValues(items, field) {
	return items.map(item => item[field]).filter(Boolean).join(", ");
}

// --- Visibility toggles ------------------------------------------------------
export function updateSportSelectionVisibility() {
	const hasPlayableCollege = hasCurrentPlayableCollegeSelection();
	const isImport = dom.isImportCheckbox.checked;
	updateImportGameScopeOptions();
	dom.gameScopeSelect.disabled = !hasPlayableCollege;
	dom.gameScopeSelect.classList.toggle("cursor-not-allowed", !hasPlayableCollege);
	dom.gameScopeSelect.classList.toggle("opacity-60", !hasPlayableCollege);
	dom.sportSelectionGateHint.textContent = isImport
		? "Select the team to join first before choosing a sport category."
		: "Select your home college first before choosing a sport category.";
	dom.sportSelectionGateHint.classList.toggle("hidden", hasPlayableCollege);
	if (!hasPlayableCollege) {
		dom.gameScopeSelect.value = "";
	}
	const scope = hasPlayableCollege ? dom.gameScopeSelect.value : "";
	const showMajor = scope === "major" || scope === "both";
	const showMinor = scope === "minor" || scope === "both";
	dom.majorSportField.classList.toggle("hidden", !showMajor);
	dom.minorSportField.classList.toggle("hidden", !showMinor);
	dom.majorSelectionHint.textContent = "Select 1 major game, or 2 valid major games.";
	dom.minorSelectionHint.textContent = scope === "both"
		? "Select exactly 1 minor game."
		: "Select 1 or 2 minor games.";
	if (!showMajor) {
		clearCheckedSports("majorSport");
	}
	if (!showMinor) {
		clearCheckedSports("minorSport");
	}
	enforceSportSelectionLimits();
	updateSubmitAvailability();
}

export function updateImportGameScopeOptions() {
	const isImport = dom.isImportCheckbox.checked;
	Array.from(dom.gameScopeSelect.options).forEach(option => {
		const isMinorScope = option.value === "minor" || option.value === "both";
		option.disabled = isImport && isMinorScope;
		option.hidden = isImport && isMinorScope;
	});
	if (isImport) {
		dom.gameScopeSelect.value = "major";
		clearCheckedSports("minorSport");
	}
}

export function updateImportFormVisibility() {
	const isImport = dom.isImportCheckbox.checked;
	const isFaculty = isFacultySelection();
	dom.documentRequirementsSection.classList.toggle("hidden", isFaculty);
	dom.importFormCard.classList.toggle("hidden", !isImport || isFaculty);
	dom.importCollegeField.classList.toggle("hidden", !isImport);
	dom.importCollegeSelect.required = isImport;
	if (isFaculty) {
		resetCameraCapture("parentPage1");
		resetCameraCapture("parentPage2");
		resetCameraCapture("medical");
	}
	if (!isImport) {
		dom.importCollegeSelect.value = "";
	}
	if (!isImport || isFaculty) {
		resetCameraCapture("importFormPage1");
		resetCameraCapture("importFormPage2");
	}
	renderCollegeOptions();
	renderSportCheckboxes();
	updateSportSelectionVisibility();
	updateSubmitAvailability();
}

// --- Data loading ------------------------------------------------------------
export async function loadRegistrationSlotCounts({ render = true } = {}) {
	const { data, error } = await supabase
		.from(REGISTRATION_SLOT_COUNTS_VIEW)
		.select("sport_id, team_id, team_name, registered_count");
	if (error) {
		console.error("Slot count load error:", error);
		state.registrationSlotCounts = [];
		openRuleNoticeModal("Unable to check available registration slots. Please refresh the page or contact the CSC admin.", "Registration Notice");
		return;
	}
	state.registrationSlotCounts = data || [];
	if (render) {
		renderSportCheckboxes();
		updateSportSelectionVisibility();
	}
}

export async function syncSportSlotAvailability() {
	state.isSyncingSportSlots = true;
	renderSportCheckboxes();
	updateSportSelectionVisibility();
	try {
		await loadRegistrationSlotCounts({ render: false });
	} finally {
		state.isSyncingSportSlots = false;
		renderSportCheckboxes();
		updateSportSelectionVisibility();
	}
}

export async function loadSports() {
	const { data, error } = await supabase
		.from(SPORTS_TABLE)
		.select("id, sport_name, game_type, player_limit")
		.order("sport_name", { ascending: true });
	if (error) {
		console.error("Sports load error:", error);
		state.sportsData = [];
		renderSportCheckboxes();
		openRuleNoticeModal("Unable to load major/minor games. Please refresh the page or contact the CSC admin.", "Registration Notice");
		return;
	}
	state.sportsData = data || [];
	renderSportCheckboxes();
	updateSportSelectionVisibility();
}
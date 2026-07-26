/*
 * CSC Cup student registration page controller (CSC-CUP-Form.html).
 *
 * Public registration form: students pick a home college and sport
 * categories, capture their parent consent / medical / import documents
 * with the camera, and submit a pending participant record plus uploaded
 * photos to Supabase.
 *
 * This page deliberately uses the REGISTRATION Supabase client (default
 * localStorage persistence) rather than the dashboard sessionStorage
 * client, so filling in the form never disturbs a signed-in dashboard
 * session in the same browser. See supabase-client.js.
 *
 * The camera hardware handling lives in features/camera-capture.js; this
 * file owns the form rules, slot availability, and submission.
 */

import { getRegistrationClient } from "../supabase-client.js";
import {
	TEAMS_TABLE,
	SPORTS_TABLE,
	PARTICIPANTS_TABLE,
	PARTICIPANT_DOCUMENTS_BUCKET,
	REGISTRATION_SLOT_COUNTS_VIEW
} from "../config.js";
import { escapeHTML } from "../utils/dom.js";
import {
	normalizeGameType,
	normalizeSportGroupKey,
	splitSportIdValues
} from "../utils/normalize.js";
import { getSportPlayerLimit } from "../utils/sports.js";
import { initBackgroundRotator } from "../features/background-rotator.js";
import {
	initCameraCapture,
	clearAllCaptures,
	resetCameraCapture,
	getCameraBlob,
	hasCameraCapture
} from "../features/camera-capture.js";

const supabase = getRegistrationClient();

// Rotating background photos. The "csc-registration-page" body class (set in
// the HTML) tunes the crossfade opacity for this page.
initBackgroundRotator();

const form = document.getElementById("registrationForm");
const formAlert = document.getElementById("formAlert");
const submitButton = document.getElementById("submitButton");
const teamSelect = document.getElementById("teamSelect");
const importCollegeField = document.getElementById("importCollegeField");
const importCollegeSelect = document.getElementById("importCollegeSelect");
const gameScopeSelect = document.getElementById("gameScopeSelect");
const sportSelectionGateHint = document.getElementById("sportSelectionGateHint");
const majorSportField = document.getElementById("majorSportField");
const majorSelectionHint = document.getElementById("majorSelectionHint");
const majorIndoorOptions = document.getElementById("majorIndoorOptions");
const majorOutdoorOptions = document.getElementById("majorOutdoorOptions");
const minorSportField = document.getElementById("minorSportField");
const minorSelectionHint = document.getElementById("minorSelectionHint");
const minorSportOptions = document.getElementById("minorSportOptions");
const isImportCheckbox = document.getElementById("isImportCheckbox");
const documentRequirementsSection = document.getElementById("documentRequirementsSection");
const importFormCard = document.getElementById("importFormCard");
const privacyNoticeModal = document.getElementById("privacyNoticeModal");
const closePrivacyNotice = document.getElementById("closePrivacyNotice");
const closePrivacyNoticeX = document.getElementById("closePrivacyNoticeX");
const successModal = document.getElementById("successModal");
const successModalMessage = document.getElementById("successModalMessage");
const closeSuccessModal = document.getElementById("closeSuccessModal");
const ruleNoticeModal = document.getElementById("ruleNoticeModal");
const ruleNoticeTitle = document.getElementById("ruleNoticeTitle");
const ruleNoticeMessage = document.getElementById("ruleNoticeMessage");
const closeRuleNotice = document.getElementById("closeRuleNotice");

const REGISTRATION_SUCCESS_MESSAGE = "Your registration has been submitted successfully. The CSC will review your registration. If your registration is forfeited or rejected, your team president will be notified. If you do not receive any notice from your president, your registration will be considered approved.";

let sportsData = [];
let teamsData = [];
let registrationSlotCounts = [];
let isSyncingSportSlots = false;
let isSubmittingRegistration = false;

const MAJOR_ONLY_LIMIT = 2;
const MINOR_MIN = 1;
const MINOR_LIMIT = 2;
const MINOR_WITH_MAJOR_LIMIT = 1;
const MAJOR_SELECTION_RULE_MESSAGE = "Players may choose 1 major game, or choose 2 major games as either 1 indoor and 1 outdoor, or 2 outdoor games only.";

// --- Alerts and modals -------------------------------------------------------
function setAlert(message, type = "error") {
	if (type !== "success") {
		openRuleNoticeModal(message, "Registration Notice");
		return;
	}
	formAlert.textContent = message;
	formAlert.className = `rounded-2xl border-2 px-5 py-4 text-base font-black form-alert-attention ${
		type === "success"
			? "border-emerald-400 bg-emerald-50 text-emerald-900"
			: "border-red-500 bg-red-50 text-red-800"
	}`;
	formAlert.classList.remove("hidden");
	formAlert.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearAlert() {
	formAlert.classList.add("hidden");
	formAlert.textContent = "";
}

function openPrivacyNotice() {
	privacyNoticeModal.classList.add("is-open");
	document.body.classList.add("overflow-hidden");
}

function closePrivacyNoticeFunction() {
	privacyNoticeModal.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
}

function openSuccessModal() {
	successModalMessage.textContent = REGISTRATION_SUCCESS_MESSAGE;
	successModal.classList.add("is-open");
	document.body.classList.add("overflow-hidden");
	closeSuccessModal.focus();
}

function closeSuccessModalFunction() {
	successModal.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
}

function openRuleNoticeModal(message = MAJOR_SELECTION_RULE_MESSAGE, title = "Sport Selection Rule") {
	clearAlert();
	ruleNoticeTitle.textContent = title;
	ruleNoticeMessage.textContent = message;
	ruleNoticeModal.classList.add("is-open");
	document.body.classList.add("overflow-hidden");
}

function closeRuleNoticeModal() {
	ruleNoticeModal.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
}

// --- Colleges / teams --------------------------------------------------------
async function loadTeams() {
	const { data, error } = await supabase
		.from(TEAMS_TABLE)
		.select("id, team")
		.order("team", { ascending: true });
	if (error) {
		console.error("Team load error:", error);
		teamSelect.innerHTML = `<option value="">Unable to load colleges</option>`;
		importCollegeSelect.innerHTML = `<option value="">Unable to load colleges</option>`;
		setAlert("Unable to load colleges. Please refresh the page or contact the CSC admin.");
		return;
	}
	teamsData = data || [];
	renderCollegeOptions();
}

function renderCollegeOptions() {
	const selectedHomeCollegeId = getSelectedOptionValue(teamSelect);
	const selectedImportCollegeId = getSelectedOptionValue(importCollegeSelect);
	const optionsMarkup = teamsData.map(team => `<option value="${String(team.id)}" data-name="${escapeHTML(team.team || "")}">${escapeHTML(team.team || "Unnamed college")}</option>`).join("");
	const importOptionsMarkup = teamsData
		.filter(team => String(team.id) !== String(selectedHomeCollegeId))
		.map(team => `<option value="${String(team.id)}" data-name="${escapeHTML(team.team || "")}">${escapeHTML(team.team || "Unnamed college")}</option>`)
		.join("");
	teamSelect.innerHTML = `
	<option value="">Select your home college</option>
	${optionsMarkup}
	`;
	if (selectedHomeCollegeId && teamsData.some(team => String(team.id) === String(selectedHomeCollegeId))) {
		teamSelect.value = selectedHomeCollegeId;
	}
	importCollegeSelect.innerHTML = `
	<option value="">Select the team to join</option>
	${importOptionsMarkup}
	`;
	if (selectedImportCollegeId && selectedImportCollegeId !== selectedHomeCollegeId && teamsData.some(team => String(team.id) === String(selectedImportCollegeId))) {
		importCollegeSelect.value = selectedImportCollegeId;
	}
}

function getSelectedOptionName(select) {
	if (!getSelectedOptionValue(select)) {
		return "";
	}
	const selectedOption = select?.options?.[select.selectedIndex];
	return selectedOption?.dataset?.name || selectedOption?.textContent || "";
}

function getSelectedOptionValue(select) {
	return select?.value || "";
}

function getPlayableCollegeSelection(isImport) {
	const select = isImport ? importCollegeSelect : teamSelect;
	return {
		id: getSelectedOptionValue(select),
		name: getSelectedOptionName(select)
	};
}

function getHomeCollegeSelection() {
	return {
		id: getSelectedOptionValue(teamSelect),
		name: getSelectedOptionName(teamSelect)
	};
}

function getCurrentPlayableCollegeSelection() {
	return getPlayableCollegeSelection(isImportCheckbox.checked);
}

function hasCurrentPlayableCollegeSelection() {
	const playableCollege = getCurrentPlayableCollegeSelection();
	return Boolean(playableCollege.id);
}

function isFacultySelection() {
	const homeCollege = getHomeCollegeSelection();
	return normalizeSportGroupKey(homeCollege.name) === "faculty";
}

// --- Sports and slot availability --------------------------------------------
function getSportName(sport) {
	return sport?.sport_name || sport?.name || sport?.game_name || "Unnamed game";
}

function getSlotCountForSportCollege(sportId, college) {
	const normalizedSportId = String(sportId || "");
	const normalizedCollegeId = String(college?.id || "");
	const normalizedCollegeName = normalizeSportGroupKey(college?.name || "");
	const row = registrationSlotCounts.find(item => {
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
			const sport = sportsData.find(item => String(item.id) === String(id));
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
	if (isSyncingSportSlots) {
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

function renderSportCheckbox(container, sport, name) {
	const singlesDoublesCategory = getSinglesDoublesCategory(sport.label);
	const singlesDoublesGroup = getSinglesDoublesGroupKey(sport.label);
	const genderMixedCategory = getGenderMixedCategory(sport.label);
	const genderMixedGroup = getGenderMixedGroupKey(sport.label);
	const availability = getRemainingSlotsForSportIds(sport.value);
	const isUnavailable = isSyncingSportSlots || availability.needsCollege || (availability.hasLimit && availability.remaining <= 0);
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

function renderSportCheckboxes() {
	const majorChoices = sportsData
		.filter(sport => normalizeGameType(sport.game_type || sport.sport_type || sport.category_type) === "major")
		.sort((a, b) => getSportName(a).localeCompare(getSportName(b)))
		.map(sport => ({
			value: String(sport.id),
			label: getSportName(sport),
			venue: inferMajorSportVenue(sport),
			note: "Major game"
		}));
	const minorChoices = sportsData
		.filter(sport => normalizeGameType(sport.game_type || sport.sport_type || sport.category_type) === "minor")
		.sort((a, b) => getSportName(a).localeCompare(getSportName(b)))
		.map(sport => ({
			value: String(sport.id),
			label: getSportName(sport),
			note: "Minor game"
		}));
	majorIndoorOptions.innerHTML = majorChoices
		.filter(option => option.venue === "indoor")
		.map(option => renderSportCheckbox(majorIndoorOptions, option, "majorSport"))
		.join("") || `<p class="text-xs font-semibold text-slate-500">No indoor major games listed.</p>`;
	majorOutdoorOptions.innerHTML = majorChoices
		.filter(option => option.venue === "outdoor")
		.map(option => renderSportCheckbox(majorOutdoorOptions, option, "majorSport"))
		.join("") || `<p class="text-xs font-semibold text-slate-500">No outdoor major games listed.</p>`;
	minorSportOptions.innerHTML = minorChoices
		.map(option => renderSportCheckbox(minorSportOptions, option, "minorSport"))
		.join("") || `<p class="text-xs font-semibold text-slate-500">No minor games listed yet.</p>`;
	document.querySelectorAll('input[name="majorSport"], input[name="minorSport"]').forEach(input => {
		input.addEventListener("change", event => {
			enforceSportSelectionLimits(event);
			updateSubmitAvailability();
		});
	});
	updateSubmitAvailability();
}

function getCheckedSports(name) {
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

function clearCheckedSports(name) {
	document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
		input.checked = false;
	});
}

function enforceSportSelectionLimits(event) {
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

function hasSinglesDoublesConflict(selectedSports) {
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

function hasGenderMixedConflict(selectedSports) {
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

function hasSelectedSportsWithNoSlots(selectedSports) {
	return selectedSports.some(sport => {
		const availability = getRemainingSlotsForSportIds(sport.id);
		return availability.needsCollege || (availability.hasLimit && availability.remaining <= 0);
	});
}

function hasValidMajorSportSelection(selectedMajorSports) {
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

function getMinorSportLimit(gameScope = gameScopeSelect.value) {
	return gameScope === "both" ? MINOR_WITH_MAJOR_LIMIT : MINOR_LIMIT;
}

function hasValidMinorSportSelection(selectedMinorSports, gameScope = gameScopeSelect.value) {
	const minorLimit = getMinorSportLimit(gameScope);
	return selectedMinorSports.length >= MINOR_MIN && selectedMinorSports.length <= minorLimit;
}

function isRegistrationReadyToSubmit() {
	const isImport = isImportCheckbox.checked;
	const isFaculty = isFacultySelection();
	const gameScope = gameScopeSelect.value;
	const requiresMajor = gameScope === "major" || gameScope === "both";
	const requiresMinor = gameScope === "minor" || gameScope === "both";
	const selectedMajorSports = getCheckedSports("majorSport");
	const selectedMinorSports = getCheckedSports("minorSport");
	const selectedSports = [...selectedMajorSports, ...selectedMinorSports];
	return form.checkValidity()
		&& hasCurrentPlayableCollegeSelection()
		&& !isSyncingSportSlots
		&& Boolean(gameScope)
		&& (isFacultySelection() || hasCameraCapture("parentPage1"))
		&& (isFacultySelection() || hasCameraCapture("parentPage2"))
		&& (isFacultySelection() || hasCameraCapture("medical"))
		&& (!isImport || Boolean(importCollegeSelect.value))
		&& (isFacultySelection() || !isImport || (hasCameraCapture("importFormPage1") && hasCameraCapture("importFormPage2")))
		&& (!requiresMajor || hasValidMajorSportSelection(selectedMajorSports))
		&& (!requiresMinor || hasValidMinorSportSelection(selectedMinorSports, gameScope))
		&& !hasSinglesDoublesConflict(selectedSports)
		&& !hasGenderMixedConflict(selectedSports)
		&& !hasSelectedSportsWithNoSlots(selectedSports);
}

function updateSubmitAvailability() {
	if (isSubmittingRegistration) {
		return;
	}
	submitButton.disabled = !isRegistrationReadyToSubmit();
}

function joinSelectionValues(items, field) {
	return items.map(item => item[field]).filter(Boolean).join(", ");
}

function updateSportSelectionVisibility() {
	const hasPlayableCollege = hasCurrentPlayableCollegeSelection();
	const isImport = isImportCheckbox.checked;
	updateImportGameScopeOptions();
	gameScopeSelect.disabled = !hasPlayableCollege;
	gameScopeSelect.classList.toggle("cursor-not-allowed", !hasPlayableCollege);
	gameScopeSelect.classList.toggle("opacity-60", !hasPlayableCollege);
	sportSelectionGateHint.textContent = isImport
		? "Select the team to join first before choosing a sport category."
		: "Select your home college first before choosing a sport category.";
	sportSelectionGateHint.classList.toggle("hidden", hasPlayableCollege);
	if (!hasPlayableCollege) {
		gameScopeSelect.value = "";
	}
	const scope = hasPlayableCollege ? gameScopeSelect.value : "";
	const showMajor = scope === "major" || scope === "both";
	const showMinor = scope === "minor" || scope === "both";
	majorSportField.classList.toggle("hidden", !showMajor);
	minorSportField.classList.toggle("hidden", !showMinor);
	majorSelectionHint.textContent = "Select 1 major game, or 2 valid major games.";
	minorSelectionHint.textContent = scope === "both"
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

function updateImportGameScopeOptions() {
	const isImport = isImportCheckbox.checked;
	Array.from(gameScopeSelect.options).forEach(option => {
		const isMinorScope = option.value === "minor" || option.value === "both";
		option.disabled = isImport && isMinorScope;
		option.hidden = isImport && isMinorScope;
	});
	if (isImport) {
		gameScopeSelect.value = "major";
		clearCheckedSports("minorSport");
	}
}

function updateImportFormVisibility() {
	const isImport = isImportCheckbox.checked;
	const isFaculty = isFacultySelection();
	documentRequirementsSection.classList.toggle("hidden", isFaculty);
	importFormCard.classList.toggle("hidden", !isImport || isFaculty);
	importCollegeField.classList.toggle("hidden", !isImport);
	importCollegeSelect.required = isImport;
	if (isFaculty) {
		resetCameraCapture("parentPage1");
		resetCameraCapture("parentPage2");
		resetCameraCapture("medical");
	}
	if (!isImport) {
		importCollegeSelect.value = "";
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

async function loadRegistrationSlotCounts({ render = true } = {}) {
	const { data, error } = await supabase
		.from(REGISTRATION_SLOT_COUNTS_VIEW)
		.select("sport_id, team_id, team_name, registered_count");
	if (error) {
		console.error("Slot count load error:", error);
		registrationSlotCounts = [];
		setAlert("Unable to check available registration slots. Please refresh the page or contact the CSC admin.");
		return;
	}
	registrationSlotCounts = data || [];
	if (render) {
		renderSportCheckboxes();
		updateSportSelectionVisibility();
	}
}

async function syncSportSlotAvailability() {
	isSyncingSportSlots = true;
	renderSportCheckboxes();
	updateSportSelectionVisibility();
	try {
		await loadRegistrationSlotCounts({ render: false });
	} finally {
		isSyncingSportSlots = false;
		renderSportCheckboxes();
		updateSportSelectionVisibility();
	}
}

async function loadSports() {
	const { data, error } = await supabase
		.from(SPORTS_TABLE)
		.select("id, sport_name, game_type, player_limit")
		.order("sport_name", { ascending: true });
	if (error) {
		console.error("Sports load error:", error);
		sportsData = [];
		renderSportCheckboxes();
		setAlert("Unable to load major/minor games. Please refresh the page or contact the CSC admin.");
		return;
	}
	sportsData = data || [];
	renderSportCheckboxes();
	updateSportSelectionVisibility();
}

// --- Submission --------------------------------------------------------------
function getParticipantId() {
	return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function uploadDocument(participantId, type, blob) {
	const path = `participants/${participantId}/${type}.jpg`;
	const { error } = await supabase.storage
		.from(PARTICIPANT_DOCUMENTS_BUCKET)
		.upload(path, blob, {
			contentType: "image/jpeg",
			upsert: true
		});
	if (error) {
		throw error;
	}
	const { data } = supabase.storage.from(PARTICIPANT_DOCUMENTS_BUCKET).getPublicUrl(path);
	return data?.publicUrl || path;
}

function getRegistrationErrorMessage(error, idNumber) {
	const rawMessage = String(error?.message || "");
	const lowerMessage = rawMessage.toLowerCase();
	const isDuplicate = error?.code === "23505"
		|| lowerMessage.includes("duplicate")
		|| lowerMessage.includes("unique")
		|| lowerMessage.includes("already exists");
	if (isDuplicate) {
		return `A registration with ID Number ${idNumber} already exists. Please check your ID number or contact the CSC admin.`;
	}
	if (lowerMessage.includes("row-level security") || lowerMessage.includes("permission denied")) {
		return "Registration could not be saved because database permission is not ready. Please contact the CSC admin.";
	}
	if (lowerMessage.includes("bucket") || lowerMessage.includes("storage")) {
		return "Document upload failed. Please make sure the photos are clear and try again.";
	}
	return rawMessage || "Registration failed. Please review the form and try again.";
}

form.addEventListener("submit", async event => {
	event.preventDefault();
	clearAlert();
	if (!form.reportValidity()) {
		return;
	}
	const isImport = isImportCheckbox.checked;
	const isFaculty = isFacultySelection();
	if (isImport && !importCollegeSelect.value) {
		setAlert("Please select the team to join as an import player.");
		importCollegeSelect.focus();
		return;
	}
	if (isImport && importCollegeSelect.value === teamSelect.value) {
		setAlert("Import players must select a team to join that is different from their home college.");
		importCollegeSelect.value = "";
		renderCollegeOptions();
		updateSubmitAvailability();
		importCollegeSelect.focus();
		return;
	}
	if (isImport && gameScopeSelect.value !== "major") {
		openRuleNoticeModal("Import players are only allowed to select major games.");
		gameScopeSelect.value = "major";
		updateSportSelectionVisibility();
		return;
	}
	if (!hasCurrentPlayableCollegeSelection()) {
		setAlert(isImport ? "Please select the team to join before choosing a sport category." : "Please select your home college before choosing a sport category.");
		(isImport ? importCollegeSelect : teamSelect).focus();
		return;
	}
	if (isSyncingSportSlots) {
		setAlert("Please wait while available slots are being checked.");
		return;
	}
	if (!isFaculty && (!hasCameraCapture("parentPage1") || !hasCameraCapture("parentPage2") || !hasCameraCapture("medical"))) {
		setAlert("Please take a picture of Parent Consent Page 1, Parent Consent Page 2, and the Medical Certificate before registering.");
		return;
	}
	if (!isFaculty && isImport && (!hasCameraCapture("importFormPage1") || !hasCameraCapture("importFormPage2"))) {
		setAlert("Please take a picture of Import Form with Signatures Page 1 and Page 2.");
		importFormCard.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	const gameScope = gameScopeSelect.value;
	const requiresMajor = gameScope === "major" || gameScope === "both";
	const requiresMinor = gameScope === "minor" || gameScope === "both";
	const selectedMajorSports = getCheckedSports("majorSport");
	const selectedMinorSports = getCheckedSports("minorSport");
	if (requiresMajor && !hasValidMajorSportSelection(selectedMajorSports)) {
		openRuleNoticeModal();
		majorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	if (requiresMinor && !hasValidMinorSportSelection(selectedMinorSports, gameScope)) {
		const minorLimit = getMinorSportLimit(gameScope);
		openRuleNoticeModal(minorLimit === MINOR_WITH_MAJOR_LIMIT
			? "Please select exactly 1 minor game."
			: `Please select ${MINOR_MIN} or ${MINOR_LIMIT} minor games.`);
		minorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	if (hasSinglesDoublesConflict([...selectedMajorSports, ...selectedMinorSports])) {
		openRuleNoticeModal("You cannot select singles and doubles categories for the same game at the same time.");
		minorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	if (hasGenderMixedConflict([...selectedMajorSports, ...selectedMinorSports])) {
		openRuleNoticeModal("You cannot select boys, girls, and mixed doubles categories for the same game at the same time.");
		minorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	const selectedSportsWithNoSlots = [...selectedMajorSports, ...selectedMinorSports].filter(sport => hasSelectedSportsWithNoSlots([sport]));
	if (selectedSportsWithNoSlots.length) {
		openRuleNoticeModal(`${selectedSportsWithNoSlots[0].name} has no available slots left for your selected college.`);
		return;
	}
	const participantId = getParticipantId();
	isSubmittingRegistration = true;
	submitButton.disabled = true;
	submitButton.textContent = "Submitting registration...";
	try {
		const fullName = document.getElementById("fullName").value.trim();
		const idNumber = document.getElementById("idNumber").value.trim();
		const homeCollege = getHomeCollegeSelection();
		const playableCollege = getPlayableCollegeSelection(isImport);
		const majorSportName = requiresMajor ? joinSelectionValues(selectedMajorSports, "name") : "";
		const minorSportName = requiresMinor ? joinSelectionValues(selectedMinorSports, "name") : "";
		const majorSportIds = requiresMajor ? joinSelectionValues(selectedMajorSports, "id") : null;
		const minorSportIds = requiresMinor ? joinSelectionValues(selectedMinorSports, "id") : null;
		const parentConsentPage1Url = isFaculty ? null : await uploadDocument(participantId, "parent-consent-page-1", getCameraBlob("parentPage1"));
		const parentConsentPage2Url = isFaculty ? null : await uploadDocument(participantId, "parent-consent-page-2", getCameraBlob("parentPage2"));
		const medicalCertificateUrl = isFaculty ? null : await uploadDocument(participantId, "medical-certificate", getCameraBlob("medical"));
		const importFormPage1Url = !isFaculty && isImport
			? await uploadDocument(participantId, "import-form-with-signatures-page-1", getCameraBlob("importFormPage1"))
			: null;
		const importFormPage2Url = !isFaculty && isImport
			? await uploadDocument(participantId, "import-form-with-signatures-page-2", getCameraBlob("importFormPage2"))
			: null;
		const importFormPhotoValue = !isFaculty && isImport
			? JSON.stringify({
				page1: importFormPage1Url,
				page2: importFormPage2Url
			})
			: null;
		const participantRecord = {
			full_name: fullName,
			name: fullName,
			course: document.getElementById("course").value.trim(),
			age: Number(document.getElementById("age").value),
			id_number: idNumber,
			student_id: idNumber,
			home_college_id: homeCollege.id || null,
			home_college: homeCollege.name,
			import_college_id: isImport ? (playableCollege.id || null) : null,
			import_college: isImport ? playableCollege.name : null,
			team_id: playableCollege.id || null,
			team_name: playableCollege.name,
			team: playableCollege.name,
			game_scope: gameScope,
			major_sport_id: majorSportIds,
			major_sport_name: majorSportName,
			minor_sport_id: minorSportIds,
			minor_sport_name: minorSportName,
			is_import: isImport,
			import_form_photo: importFormPhotoValue,
			parent_consent_photo: isFaculty ? null : JSON.stringify({
				page1: parentConsentPage1Url,
				page2: parentConsentPage2Url
			}),
			medical_certificate_photo: medicalCertificateUrl,
			status: "pending",
			created_at: new Date().toISOString()
		};
		const { error } = await supabase
			.from(PARTICIPANTS_TABLE)
			.insert([participantRecord]);
		if (error) {
			throw error;
		}
		form.reset();
		clearAllCaptures();
		updateImportFormVisibility();
		await loadTeams();
		await loadSports();
		await loadRegistrationSlotCounts();
		setAlert(REGISTRATION_SUCCESS_MESSAGE, "success");
		openSuccessModal();
	} catch (error) {
		console.error("Registration error:", error);
		setAlert(getRegistrationErrorMessage(error, document.getElementById("idNumber").value.trim()));
	} finally {
		isSubmittingRegistration = false;
		submitButton.disabled = false;
		submitButton.textContent = "Register for CSC Cup";
		updateSubmitAvailability();
	}
});

// --- Event wiring and init ---------------------------------------------------
form.addEventListener("input", updateSubmitAvailability);
form.addEventListener("change", updateSubmitAvailability);
gameScopeSelect.addEventListener("change", updateSportSelectionVisibility);
isImportCheckbox.addEventListener("change", updateImportFormVisibility);
teamSelect.addEventListener("change", () => {
	renderCollegeOptions();
	updateImportFormVisibility();
	syncSportSlotAvailability();
});
importCollegeSelect.addEventListener("change", () => {
	syncSportSlotAvailability();
});
closePrivacyNotice.addEventListener("click", closePrivacyNoticeFunction);
closePrivacyNoticeX.addEventListener("click", closePrivacyNoticeFunction);
privacyNoticeModal.addEventListener("click", event => {
	if (event.target === privacyNoticeModal) {
		closePrivacyNoticeFunction();
	}
});
closeSuccessModal.addEventListener("click", closeSuccessModalFunction);
closeRuleNotice.addEventListener("click", closeRuleNoticeModal);
ruleNoticeModal.addEventListener("click", event => {
	if (event.target === ruleNoticeModal) {
		closeRuleNoticeModal();
	}
});
successModal.addEventListener("click", event => {
	if (event.target === successModal) {
		closeSuccessModalFunction();
	}
});
document.addEventListener("keydown", event => {
	if (event.key === "Escape" && privacyNoticeModal.classList.contains("is-open")) {
		closePrivacyNoticeFunction();
		return;
	}
	if (event.key === "Escape" && ruleNoticeModal.classList.contains("is-open")) {
		closeRuleNoticeModal();
		return;
	}
	if (event.key === "Escape" && successModal.classList.contains("is-open")) {
		closeSuccessModalFunction();
	}
});

initCameraCapture({ onCapture: updateSubmitAvailability });
openPrivacyNotice();
updateImportFormVisibility();
Promise.all([loadTeams(), loadSports(), loadRegistrationSlotCounts()]);
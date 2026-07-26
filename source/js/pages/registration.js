/*
 * CSC Cup registration page orchestrator (CSC-CUP-Form.html).
 *
 * This is the entry point loaded by the HTML. It does three things:
 *   1. Queries every DOM element the feature modules need and stores
 *      the references in the shared `dom` object (registration-context.js).
 *   2. Wires all event listeners.
 *   3. Runs the init sequence (rotator, camera, privacy modal, data load).
 *
 * All actual logic lives in the feature modules:
 *   features/registration-ui.js        — alerts and modals
 *   features/registration-colleges.js  — team/college loading and selection
 *   features/registration-sports.js    — sport rules, slots, visibility
 *   features/registration-submit.js    — form submission and upload
 *   features/camera-capture.js         — getUserMedia document scanner
 *   features/background-rotator.js     — photo crossfade
 */

import { dom } from "./registration-context.js";
import { initBackgroundRotator } from "../features/background-rotator.js";
import { initCameraCapture } from "../features/camera-capture.js";
import {
	openPrivacyNotice,
	closePrivacyNoticeFunction,
	closeSuccessModalFunction,
	closeRuleNoticeModal
} from "../features/registration-ui.js";
import { loadTeams, renderCollegeOptions } from "../features/registration-colleges.js";
import {
	updateSubmitAvailability,
	updateSportSelectionVisibility,
	updateImportFormVisibility,
	syncSportSlotAvailability,
	loadSports,
	loadRegistrationSlotCounts
} from "../features/registration-sports.js";
import { handleSubmit } from "../features/registration-submit.js";

// --- 1. Query DOM elements into the shared context ---------------------------
dom.form = document.getElementById("registrationForm");
dom.formAlert = document.getElementById("formAlert");
dom.submitButton = document.getElementById("submitButton");
dom.teamSelect = document.getElementById("teamSelect");
dom.importCollegeField = document.getElementById("importCollegeField");
dom.importCollegeSelect = document.getElementById("importCollegeSelect");
dom.gameScopeSelect = document.getElementById("gameScopeSelect");
dom.sportSelectionGateHint = document.getElementById("sportSelectionGateHint");
dom.majorSportField = document.getElementById("majorSportField");
dom.majorSelectionHint = document.getElementById("majorSelectionHint");
dom.majorIndoorOptions = document.getElementById("majorIndoorOptions");
dom.majorOutdoorOptions = document.getElementById("majorOutdoorOptions");
dom.minorSportField = document.getElementById("minorSportField");
dom.minorSelectionHint = document.getElementById("minorSelectionHint");
dom.minorSportOptions = document.getElementById("minorSportOptions");
dom.isImportCheckbox = document.getElementById("isImportCheckbox");
dom.documentRequirementsSection = document.getElementById("documentRequirementsSection");
dom.importFormCard = document.getElementById("importFormCard");
dom.privacyNoticeModal = document.getElementById("privacyNoticeModal");
dom.closePrivacyNotice = document.getElementById("closePrivacyNotice");
dom.closePrivacyNoticeX = document.getElementById("closePrivacyNoticeX");
dom.successModal = document.getElementById("successModal");
dom.successModalMessage = document.getElementById("successModalMessage");
dom.closeSuccessModal = document.getElementById("closeSuccessModal");
dom.ruleNoticeModal = document.getElementById("ruleNoticeModal");
dom.ruleNoticeTitle = document.getElementById("ruleNoticeTitle");
dom.ruleNoticeMessage = document.getElementById("ruleNoticeMessage");
dom.closeRuleNotice = document.getElementById("closeRuleNotice");

// --- 2. Wire event listeners -------------------------------------------------
dom.form.addEventListener("submit", handleSubmit);
dom.form.addEventListener("input", updateSubmitAvailability);
dom.form.addEventListener("change", updateSubmitAvailability);
dom.gameScopeSelect.addEventListener("change", updateSportSelectionVisibility);
dom.isImportCheckbox.addEventListener("change", updateImportFormVisibility);
dom.teamSelect.addEventListener("change", () => {
	renderCollegeOptions();
	updateImportFormVisibility();
	syncSportSlotAvailability();
});
dom.importCollegeSelect.addEventListener("change", () => {
	syncSportSlotAvailability();
});
dom.closePrivacyNotice.addEventListener("click", closePrivacyNoticeFunction);
dom.closePrivacyNoticeX.addEventListener("click", closePrivacyNoticeFunction);
dom.privacyNoticeModal.addEventListener("click", event => {
	if (event.target === dom.privacyNoticeModal) {
		closePrivacyNoticeFunction();
	}
});
dom.closeSuccessModal.addEventListener("click", closeSuccessModalFunction);
dom.successModal.addEventListener("click", event => {
	if (event.target === dom.successModal) {
		closeSuccessModalFunction();
	}
});
dom.closeRuleNotice.addEventListener("click", closeRuleNoticeModal);
dom.ruleNoticeModal.addEventListener("click", event => {
	if (event.target === dom.ruleNoticeModal) {
		closeRuleNoticeModal();
	}
});
document.addEventListener("keydown", event => {
	if (event.key === "Escape" && dom.privacyNoticeModal.classList.contains("is-open")) {
		closePrivacyNoticeFunction();
		return;
	}
	if (event.key === "Escape" && dom.ruleNoticeModal.classList.contains("is-open")) {
		closeRuleNoticeModal();
		return;
	}
	if (event.key === "Escape" && dom.successModal.classList.contains("is-open")) {
		closeSuccessModalFunction();
	}
});

// --- 3. Init sequence --------------------------------------------------------
initBackgroundRotator();
initCameraCapture({ onCapture: updateSubmitAvailability });
openPrivacyNotice();
updateImportFormVisibility();
Promise.all([loadTeams(), loadSports(), loadRegistrationSlotCounts()]);
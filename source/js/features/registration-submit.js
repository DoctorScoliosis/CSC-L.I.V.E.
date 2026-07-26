/*
 * Form submission and document upload for the CSC Cup registration page.
 *
 * Owns the submit handler: validates the full form state, uploads camera
 * captures to Supabase Storage, inserts the participant record, and resets
 * the form on success. Error mapping (duplicate ID, RLS, storage) lives
 * here too.
 */

import { supabase, state, dom, MINOR_MIN, MINOR_LIMIT, MINOR_WITH_MAJOR_LIMIT } from "../pages/registration-context.js";
import { PARTICIPANTS_TABLE, PARTICIPANT_DOCUMENTS_BUCKET } from "../config.js";
import { setAlert, clearAlert, openRuleNoticeModal, openSuccessModal } from "./registration-ui.js";
import {
	getHomeCollegeSelection,
	getPlayableCollegeSelection,
	hasCurrentPlayableCollegeSelection,
	isFacultySelection,
	renderCollegeOptions,
	loadTeams
} from "./registration-colleges.js";
import {
	getCheckedSports,
	hasValidMajorSportSelection,
	getMinorSportLimit,
	hasValidMinorSportSelection,
	hasSinglesDoublesConflict,
	hasGenderMixedConflict,
	hasSelectedSportsWithNoSlots,
	joinSelectionValues,
	updateSportSelectionVisibility,
	updateSubmitAvailability,
	updateImportFormVisibility,
	loadSports,
	loadRegistrationSlotCounts
} from "./registration-sports.js";
import { getCameraBlob, hasCameraCapture, clearAllCaptures } from "./camera-capture.js";

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

export async function handleSubmit(event) {
	event.preventDefault();
	clearAlert();
	if (!dom.form.reportValidity()) {
		return;
	}
	const isImport = dom.isImportCheckbox.checked;
	const isFaculty = isFacultySelection();
	if (isImport && !dom.importCollegeSelect.value) {
		setAlert("Please select the team to join as an import player.");
		dom.importCollegeSelect.focus();
		return;
	}
	if (isImport && dom.importCollegeSelect.value === dom.teamSelect.value) {
		setAlert("Import players must select a team to join that is different from their home college.");
		dom.importCollegeSelect.value = "";
		renderCollegeOptions();
		updateSubmitAvailability();
		dom.importCollegeSelect.focus();
		return;
	}
	if (isImport && dom.gameScopeSelect.value !== "major") {
		openRuleNoticeModal("Import players are only allowed to select major games.");
		dom.gameScopeSelect.value = "major";
		updateSportSelectionVisibility();
		return;
	}
	if (!hasCurrentPlayableCollegeSelection()) {
		setAlert(isImport ? "Please select the team to join before choosing a sport category." : "Please select your home college before choosing a sport category.");
		(isImport ? dom.importCollegeSelect : dom.teamSelect).focus();
		return;
	}
	if (state.isSyncingSportSlots) {
		setAlert("Please wait while available slots are being checked.");
		return;
	}
	if (!isFaculty && (!hasCameraCapture("parentPage1") || !hasCameraCapture("parentPage2") || !hasCameraCapture("medical"))) {
		setAlert("Please take a picture of Parent Consent Page 1, Parent Consent Page 2, and the Medical Certificate before registering.");
		return;
	}
	if (!isFaculty && isImport && (!hasCameraCapture("importFormPage1") || !hasCameraCapture("importFormPage2"))) {
		setAlert("Please take a picture of Import Form with Signatures Page 1 and Page 2.");
		dom.importFormCard.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	const gameScope = dom.gameScopeSelect.value;
	const requiresMajor = gameScope === "major" || gameScope === "both";
	const requiresMinor = gameScope === "minor" || gameScope === "both";
	const selectedMajorSports = getCheckedSports("majorSport");
	const selectedMinorSports = getCheckedSports("minorSport");
	if (requiresMajor && !hasValidMajorSportSelection(selectedMajorSports)) {
		openRuleNoticeModal();
		dom.majorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	if (requiresMinor && !hasValidMinorSportSelection(selectedMinorSports, gameScope)) {
		const minorLimit = getMinorSportLimit(gameScope);
		openRuleNoticeModal(minorLimit === MINOR_WITH_MAJOR_LIMIT
			? "Please select exactly 1 minor game."
			: `Please select ${MINOR_MIN} or ${MINOR_LIMIT} minor games.`);
		dom.minorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	if (hasSinglesDoublesConflict([...selectedMajorSports, ...selectedMinorSports])) {
		openRuleNoticeModal("You cannot select singles and doubles categories for the same game at the same time.");
		dom.minorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	if (hasGenderMixedConflict([...selectedMajorSports, ...selectedMinorSports])) {
		openRuleNoticeModal("You cannot select boys, girls, and mixed doubles categories for the same game at the same time.");
		dom.minorSportField.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	const selectedSportsWithNoSlots = [...selectedMajorSports, ...selectedMinorSports].filter(sport => hasSelectedSportsWithNoSlots([sport]));
	if (selectedSportsWithNoSlots.length) {
		openRuleNoticeModal(`${selectedSportsWithNoSlots[0].name} has no available slots left for your selected college.`);
		return;
	}
	const participantId = getParticipantId();
	state.isSubmittingRegistration = true;
	dom.submitButton.disabled = true;
	dom.submitButton.textContent = "Submitting registration...";
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
		dom.form.reset();
		clearAllCaptures();
		updateImportFormVisibility();
		await loadTeams();
		await loadSports();
		await loadRegistrationSlotCounts();
		setAlert("Your registration has been submitted successfully. The CSC will review your registration. If your registration is forfeited or rejected, your team president will be notified. If you do not receive any notice from your president, your registration will be considered approved.", "success");
		openSuccessModal();
	} catch (error) {
		console.error("Registration error:", error);
		setAlert(getRegistrationErrorMessage(error, document.getElementById("idNumber").value.trim()));
	} finally {
		state.isSubmittingRegistration = false;
		dom.submitButton.disabled = false;
		dom.submitButton.textContent = "Register for CSC Cup";
		updateSubmitAvailability();
	}
}
/*
 * Participants tab for the Admin dashboard.
 *
 * Owns the participant list: filtering, loading, rendering, the add/edit
 * save + delete workflow, storage cleanup, the details modal, and the
 * approve/pending/reject review actions.
 *
 * The add/edit modal open/close + form-field helpers live in
 * admin-participant-form.js (sub-phase 3.5.2.1) — this module imports them.
 * Document card rendering + printing live in admin-participant-details.js.
 *
 * NOTE on module boundaries: admin-teams.js imports renderParticipantTeamFilter
 * and renderParticipantTeamOptions from this module, and saveParticipant here
 * calls loadTeams from admin-teams.js. That is a function-level cycle (both
 * are only ever called at runtime, never at module-evaluation time), which
 * ES modules resolve safely. It is intentional and documented.
 */

import {
	state,
	dom,
	supabase,
	PARTICIPANTS_TABLE,
	PARTICIPANT_DOCUMENTS_BUCKET
} from "../pages/admin-context.js";
import {
	normalizeParticipantStatus,
	getParticipantStatusLabel,
	getParticipantStatusClass,
	getParticipantDisplayName,
	getParticipantCourse,
	getParticipantAge,
	getParticipantIdNumber,
	getParticipantTeamName,
	getParticipantHomeCollege,
	getParticipantImportCollege,
	getParticipantGameScopeLabel,
	getParticipantMajorSportName,
	getParticipantMinorSportName,
	isParticipantImport,
	getParticipantPhotoUrls,
	splitParticipantSportNames,
	normalizeParticipantTeam
} from "../pages/admin-participant-helpers.js";
import {
	renderParticipantDocumentCards,
	openParticipantImageViewer,
	printSelectedParticipantDocuments
} from "./admin-participant-details.js";
import { loadAdminOverviewCounts } from "./admin-overview.js";
import { loadTeams } from "./admin-teams.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime, formatDateTimeLocalInput, getDateTimeLocalInputISO } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";
import {
	openEditParticipantModal,
	closeParticipantModalFunction,
	getSelectedTeamId,
	normalizeParticipantGameScopeValue,
	getParticipantSportIdForSave
} from "./admin-participant-form.js";

// --- Filtering ---------------------------------------------------------------
function getParticipantTeamFilterValue() {
	return normalizeParticipantTeam(dom.participantTeamFilter?.value || "");
}

function normalizeParticipantSport(value) {
	return String(value || "").trim();
}

function getParticipantSportFilterValue() {
	return normalizeParticipantSport(dom.participantSportFilter?.value || "");
}

function participantHasSport(participant, selectedSport) {
	if (!selectedSport) {
		return true;
	}
	const normalizedSelectedSport = normalizeParticipantSport(selectedSport).toLowerCase();
	const sportNames = [
		getParticipantMajorSportName(participant),
		getParticipantMinorSportName(participant)
	].flatMap(splitParticipantSportNames).map(name => name.toLowerCase());
	return sportNames.includes(normalizedSelectedSport);
}

function getFilteredParticipants() {
	const selectedTeam = getParticipantTeamFilterValue();
	const selectedSport = getParticipantSportFilterValue();
	if (!selectedTeam && !selectedSport) {
		return state.participantsData;
	}
	return state.participantsData.filter(participant => {
		const matchesTeam = !selectedTeam
			|| normalizeParticipantTeam(getParticipantTeamName(participant)).toLowerCase() === selectedTeam.toLowerCase();
		const matchesSport = participantHasSport(participant, selectedSport);
		return matchesTeam && matchesSport;
	});
}

export function renderParticipantTeamFilter() {
	if (!dom.participantTeamFilter) {
		return;
	}
	const currentValue = getParticipantTeamFilterValue();
	const teamNames = new Set();
	state.teamsData.forEach(team => {
		const teamName = normalizeParticipantTeam(team?.team || team?.name);
		if (teamName) {
			teamNames.add(teamName);
		}
	});
	state.participantsData.forEach(participant => {
		const teamName = normalizeParticipantTeam(getParticipantTeamName(participant));
		if (teamName) {
			teamNames.add(teamName);
		}
	});
	const sortedTeams = Array.from(teamNames).sort((a, b) => a.localeCompare(b));
	dom.participantTeamFilter.innerHTML = `
	<option value="">All Teams</option>
	${sortedTeams.map(teamName => `
	<option value="${escapeHTML(teamName)}" ${teamName === currentValue ? "selected" : ""}>
	${escapeHTML(teamName)}
	</option>
	`).join("")}
	`;
	if (currentValue && !teamNames.has(currentValue)) {
		dom.participantTeamFilter.value = "";
	}
}

export function renderParticipantSportFilter() {
	if (!dom.participantSportFilter) {
		return;
	}
	const currentValue = getParticipantSportFilterValue();
	const sportNames = new Set();
	state.sportsData.forEach(sport => {
		const sportName = normalizeParticipantSport(sport?.sport_name || sport?.name || sport?.game_name);
		if (sportName) {
			sportNames.add(sportName);
		}
	});
	state.participantsData.forEach(participant => {
		[getParticipantMajorSportName(participant), getParticipantMinorSportName(participant)].forEach(sportName => {
			splitParticipantSportNames(sportName).forEach(normalizedSportName => sportNames.add(normalizedSportName));
		});
	});
	const sortedSports = Array.from(sportNames).sort((a, b) => a.localeCompare(b));
	dom.participantSportFilter.innerHTML = `
	<option value="">All Sports</option>
	${sortedSports.map(sportName => `
	<option value="${escapeHTML(sportName)}" ${sportName === currentValue ? "selected" : ""}>
	${escapeHTML(sportName)}
	</option>
	`).join("")}
	`;
	if (currentValue && !sportNames.has(currentValue)) {
		dom.participantSportFilter.value = "";
	}
}

// --- Load + render -----------------------------------------------------------
export async function loadParticipants() {
	if (state.participantsData.length === 0) {
		dom.participantsTableBody.innerHTML = `
		<tr>
		<td colspan="11" class="py-4 px-4 text-gray-600">
		Loading participants...
		</td>
		</tr>
		`;
	}
	const { data, error } = await supabase
		.from(PARTICIPANTS_TABLE)
		.select("*")
		.order("created_at", { ascending: false });
	if (error) {
		console.error("Error loading participants:", error.message || error);
		dom.participantsTableBody.innerHTML = `
		<tr>
		<td colspan="11" class="py-4 px-4 text-red-600">
		Error loading participants. Check your participants table and RLS policies.
		</td>
		</tr>
		`;
		return;
	}
	state.participantsData = data || [];
	renderParticipantTeamFilter();
	renderParticipantSportFilter();
	renderPrintTeamOptions();
	renderParticipants();
	if (state.sportsData.length > 0) {
		renderSports();
	}
	updateAdminMessageNotification();
}

export function renderParticipants() {
	dom.participantsTableBody.innerHTML = "";
	const filteredParticipants = getFilteredParticipants();
	if (state.participantsData.length === 0) {
		dom.participantsTableBody.innerHTML = `
		<tr>
		<td colspan="11" class="py-4 px-4 text-gray-600">
		No participants found.
		</td>
		</tr>
		`;
		return;
	}
	if (filteredParticipants.length === 0) {
		dom.participantsTableBody.innerHTML = `
		<tr>
		<td colspan="11" class="py-4 px-4 text-gray-600">
		No participants found for the selected team.
		</td>
		</tr>
		`;
		return;
	}
	filteredParticipants.forEach(participant => {
		const row = document.createElement("tr");
		row.className = "participant-row cursor-pointer border-b border-gray-100 hover:bg-blue-50";
		row.dataset.participantId = participant.id;
		row.innerHTML = `
		<td class="py-3 px-4 font-medium text-gray-900">
		${escapeHTML(getParticipantDisplayName(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantCourse(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantAge(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantIdNumber(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantTeamName(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantGameScopeLabel(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantMajorSportName(participant))}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getParticipantMinorSportName(participant))}
		</td>
		<td class="py-3 px-4">
		<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getParticipantStatusClass(participant.status)}">
		${escapeHTML(getParticipantStatusLabel(participant.status))}
		</span>
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(formatDateTime(participant.created_at))}
		</td>
		<td class="py-3 px-4 space-x-2 whitespace-nowrap">
		<button
		type="button"
		data-participant-id="${participant.id}"
		class="edit-participant-btn text-blue-600 hover:text-blue-700 font-medium text-sm">
		Edit
		</button>
		<button
		type="button"
		data-participant-id="${participant.id}"
		class="delete-participant-btn text-red-600 hover:text-red-700 font-medium text-sm">
		Remove
		</button>
		</td>
		`;
		dom.participantsTableBody.appendChild(row);
	});
	document.querySelectorAll(".participant-row").forEach(row => {
		row.addEventListener("click", function () {
			const selectedParticipant = state.participantsData.find(participant => {
				return String(participant.id) === String(this.dataset.participantId);
			});
			if (selectedParticipant) {
				openParticipantDetailsModal(selectedParticipant);
			}
		});
	});
	document.querySelectorAll(".edit-participant-btn").forEach(button => {
		button.addEventListener("click", function (event) {
			event.stopPropagation();
			const selectedParticipant = state.participantsData.find(participant => {
				return String(participant.id) === String(this.dataset.participantId);
			});
			if (selectedParticipant) {
				openEditParticipantModal(selectedParticipant);
			}
		});
	});
	document.querySelectorAll(".delete-participant-btn").forEach(button => {
		button.addEventListener("click", function (event) {
			event.stopPropagation();
			deleteParticipant(this.dataset.participantId);
		});
	});
}

// --- Save + delete -----------------------------------------------------------
export async function saveParticipant(event) {
	event.preventDefault();
	const participantNameValue = dom.participantName.value.trim();
	const studentIdValue = dom.participantStudentId.value.trim();
	const selectedHomeCollegeName = dom.participantHomeCollege.value.trim();
	const selectedTeamName = dom.participantTeam.value.trim();
	const selectedImportCollegeName = dom.participantIsImport.checked ? dom.participantImportCollege.value.trim() : "";
	const majorSportName = dom.participantMajorSportName.value.trim();
	const minorSportName = dom.participantMinorSportName.value.trim();
	const createdAtValue = getDateTimeLocalInputISO(dom.participantCreatedAt);
	const reviewedAtValue = getDateTimeLocalInputISO(dom.participantReviewedAt);
	const participantData = {
		name: participantNameValue,
		full_name: participantNameValue,
		course: dom.participantCourse.value.trim() || null,
		age: dom.participantAge.value ? Number(dom.participantAge.value) : null,
		student_id: studentIdValue,
		id_number: studentIdValue,
		home_college_id: getSelectedTeamId(dom.participantHomeCollege),
		home_college: selectedHomeCollegeName || selectedTeamName,
		team_id: getSelectedTeamId(dom.participantTeam),
		team: selectedTeamName,
		team_name: selectedTeamName,
		is_import: dom.participantIsImport.checked,
		import_college_id: dom.participantIsImport.checked ? getSelectedTeamId(dom.participantImportCollege) : null,
		import_college: selectedImportCollegeName || null,
		game_scope: normalizeParticipantGameScopeValue(dom.participantGameScope.value),
		major_sport_id: getParticipantSportIdForSave("major_sport_id", majorSportName, "major"),
		major_sport_name: majorSportName || null,
		minor_sport_id: getParticipantSportIdForSave("minor_sport_id", minorSportName, "minor"),
		minor_sport_name: minorSportName || null,
		status: normalizeParticipantStatus(dom.participantStatus.value),
		reviewed_by_name: dom.participantReviewedByName.value.trim() || null,
		reviewed_at: reviewedAtValue,
		rejection_reason: dom.participantRejectionReasonEdit.value.trim() || null
	};
	if (createdAtValue) {
		participantData.created_at = createdAtValue;
	}
	if (!participantData.name || !participantData.student_id || !participantData.team) {
		alert("Please complete the participant name, student ID, and team.");
		return;
	}
	if (participantData.is_import && !selectedImportCollegeName) {
		alert("Please select the import college for this import player.");
		dom.participantImportCollege.focus();
		return;
	}
	const { data: existingParticipant, error: duplicateCheckError } = await supabase
		.from(PARTICIPANTS_TABLE)
		.select("id, name, full_name, student_id, id_number")
		.or(`student_id.eq.${participantData.student_id},id_number.eq.${participantData.id_number}`)
		.limit(1)
		.maybeSingle();
	if (duplicateCheckError) {
		console.error("Error checking participant Student ID:", duplicateCheckError.message || duplicateCheckError);
		alert(`Unable to verify the Student ID before saving: ${duplicateCheckError.message || "Unknown database error."}`);
		return;
	}
	if (existingParticipant && String(existingParticipant.id) !== String(dom.participantId.value || "")) {
		alert(`Student ID ${participantData.student_id} is already assigned to ${existingParticipant.full_name || existingParticipant.name || "another participant"}.`);
		dom.participantStudentId.focus();
		return;
	}
	let result;
	if (dom.participantId.value) {
		result = await supabase
			.from(PARTICIPANTS_TABLE)
			.update(participantData)
			.eq("id", dom.participantId.value);
	} else {
		result = await supabase
			.from(PARTICIPANTS_TABLE)
			.insert([participantData]);
	}
	if (result.error) {
		console.error("Error saving participant:", result.error.message || result.error);
		const databaseMessage = result.error.message || "Unknown database error.";
		const isDuplicateStudentId = result.error.code === "23505"
			|| databaseMessage.toLowerCase().includes("duplicate");
		const isPermissionError = result.error.code === "42501"
			|| databaseMessage.toLowerCase().includes("row-level security")
			|| databaseMessage.toLowerCase().includes("permission denied");
		if (isDuplicateStudentId) {
			alert(`Student ID ${participantData.student_id} already exists. Please use a different Student ID.`);
		} else if (isPermissionError) {
			alert("Your admin account is not permitted to save participants. Please check the participants table RLS insert/update policy.");
		} else {
			alert(`Error saving participant: ${databaseMessage}`);
		}
		return;
	}
	alert(dom.participantId.value ? "Participant updated successfully!" : "Participant added successfully!");
	closeParticipantModalFunction();
	await Promise.all([
		loadParticipants(),
		loadTeams(),
		loadAdminOverviewCounts()
	]);
}

function getParticipantDocumentStoragePath(url) {
	const rawUrl = String(url || "").trim();
	if (!rawUrl) {
		return "";
	}
	const bucketMarker = `/${PARTICIPANT_DOCUMENTS_BUCKET}/`;
	if (rawUrl.includes(bucketMarker)) {
		return decodeURIComponent(rawUrl.split(bucketMarker).pop().split("?")[0]);
	}
	if (rawUrl.startsWith("participants/")) {
		return rawUrl;
	}
	try {
		const parsedUrl = new URL(rawUrl);
		const marker = `/storage/v1/object/public/${PARTICIPANT_DOCUMENTS_BUCKET}/`;
		const pathIndex = parsedUrl.pathname.indexOf(marker);
		if (pathIndex >= 0) {
			return decodeURIComponent(parsedUrl.pathname.slice(pathIndex + marker.length));
		}
	} catch (error) {
		return "";
	}
	return "";
}

function getParticipantDocumentStoragePaths(participant) {
	const urls = [
		...getParticipantPhotoUrls(participant, "parent_consent_photo"),
		...getParticipantPhotoUrls(participant, "medical_certificate_photo"),
		...getParticipantPhotoUrls(participant, "import_form_photo")
	];
	return Array.from(new Set(urls.map(getParticipantDocumentStoragePath).filter(Boolean)));
}

async function removeParticipantDocumentFiles(participant) {
	const paths = getParticipantDocumentStoragePaths(participant);
	if (!paths.length) {
		return { error: null };
	}
	return supabase.storage
		.from(PARTICIPANT_DOCUMENTS_BUCKET)
		.remove(paths);
}

export async function deleteParticipant(id) {
	const confirmDelete = await showDashboardConfirm("Are you sure you want to remove this participant?", {
		title: "Remove Participant",
		confirmText: "Remove"
	});
	if (!confirmDelete) {
		return;
	}
	const participantToDelete = state.participantsData.find(participant => String(participant.id) === String(id));
	const { error } = await supabase
		.from(PARTICIPANTS_TABLE)
		.delete()
		.eq("id", id);
	if (error) {
		console.error("Error deleting participant:", error.message || error);
		alert("Failed to delete participant.");
		return;
	}
	let storageDeleteWarning = false;
	if (participantToDelete) {
		const { error: storageError } = await removeParticipantDocumentFiles(participantToDelete);
		if (storageError) {
			storageDeleteWarning = true;
			console.error("Participant document storage delete error:", storageError.message || storageError);
		}
	}
	showDashboardToast(storageDeleteWarning
		? "Participant removed from the database, but some uploaded document images could not be deleted from storage."
		: "Participant and uploaded document images removed successfully!",
		storageDeleteWarning ? "warning" : "success");
	await Promise.all([
		loadParticipants(),
		loadTeams(),
		loadAdminOverviewCounts()
	]);
}

// --- Details modal + review --------------------------------------------------
export function openParticipantDetailsModal(participant) {
	state.activeParticipantDetailsId = participant.id;
	dom.participantDetailsTitle.textContent = getParticipantDisplayName(participant);
	dom.participantRejectionReason.value = participant.rejection_reason || "";
	dom.participantReviewStatus.textContent = "";
	dom.participantDetailsContent.innerHTML = `
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
	<div class="rounded-2xl border border-gray-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-black uppercase tracking-widest text-gray-500">Registration Details</h3>
	<dl class="grid grid-cols-1 gap-3 text-sm">
	<div><dt class="font-bold text-gray-500">Full Name</dt><dd class="font-black text-gray-900">${escapeHTML(getParticipantDisplayName(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Course</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantCourse(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Age</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantAge(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">ID Number</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantIdNumber(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Home College</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantHomeCollege(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Team to Join</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantTeamName(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Import College</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantImportCollege(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Playing In</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantGameScopeLabel(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Major Sport</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantMajorSportName(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Minor Sport</dt><dd class="font-semibold text-gray-900">${escapeHTML(getParticipantMinorSportName(participant))}</dd></div>
	<div><dt class="font-bold text-gray-500">Import Player</dt><dd class="font-semibold text-gray-900">${isParticipantImport(participant) ? "Yes" : "No"}</dd></div>
	<div><dt class="font-bold text-gray-500">Current Status</dt><dd><span class="inline-flex rounded-full px-3 py-1 text-xs font-black ${getParticipantStatusClass(participant.status)}">${escapeHTML(getParticipantStatusLabel(participant.status))}</span></dd></div>
	<div><dt class="font-bold text-gray-500">Date Registered</dt><dd class="font-semibold text-gray-900">${escapeHTML(formatDateTime(participant.created_at))}</dd></div>
	</dl>
	</div>
	<div class="rounded-2xl border border-gray-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-black uppercase tracking-widest text-gray-500">Review Details</h3>
	<dl class="grid grid-cols-1 gap-3 text-sm">
	<div><dt class="font-bold text-gray-500">Reviewed By</dt><dd class="font-semibold text-gray-900">${escapeHTML(participant.reviewed_by_name || "-")}</dd></div>
	<div><dt class="font-bold text-gray-500">Reviewed At</dt><dd class="font-semibold text-gray-900">${escapeHTML(formatDateTime(participant.reviewed_at))}</dd></div>
	<div><dt class="font-bold text-gray-500">Rejection Reason</dt><dd class="whitespace-pre-wrap font-semibold text-gray-900">${escapeHTML(participant.rejection_reason || "-")}</dd></div>
	</dl>
	</div>
	</div>
	<div class="rounded-2xl border border-blue-100 bg-blue-50/80 p-4">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	<div>
	<h3 class="text-sm font-black uppercase tracking-widest text-blue-900">Document Printing</h3>
	<p class="mt-1 text-xs font-semibold text-blue-800">Select the images below, then print only the documents you need.</p>
	</div>
	<button type="button" id="printSelectedParticipantDocuments" class="rounded-xl bg-blue-700 px-4 py-3 text-sm font-black text-white shadow hover:bg-blue-800">
	Print Selected Images
	</button>
	</div>
	</div>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
	${renderParticipantDocumentCards("Parent Consent Photo", getParticipantPhotoUrls(participant, "parent_consent_photo"))}
	${renderParticipantDocumentCards("Medical Certificate Photo", getParticipantPhotoUrls(participant, "medical_certificate_photo"))}
	${isParticipantImport(participant) ? renderParticipantDocumentCards("Import Form with Signatures", getParticipantPhotoUrls(participant, "import_form_photo")) : ""}
	</div>
	`;
	dom.participantDetailsContent.querySelectorAll(".participant-document-preview").forEach(button => {
		button.addEventListener("click", () => openParticipantImageViewer(button.dataset.participantImageUrl));
	});
	dom.participantDetailsContent.querySelector("#printSelectedParticipantDocuments")?.addEventListener("click", () => {
		printSelectedParticipantDocuments(participant);
	});
	dom.participantDetailsModal.classList.remove("hidden");
	dom.participantDetailsModal.classList.add("flex");
}

export function closeParticipantDetailsModalFunction() {
	dom.participantDetailsModal.classList.add("hidden");
	dom.participantDetailsModal.classList.remove("flex");
	state.activeParticipantDetailsId = null;
	dom.participantDetailsContent.innerHTML = "";
	dom.participantReviewStatus.textContent = "";
}

export async function updateParticipantReviewStatus(status) {
	if (!state.activeParticipantDetailsId) return;
	const normalizedStatus = normalizeParticipantStatus(status);
	const rejectionReason = dom.participantRejectionReason.value.trim();
	if (normalizedStatus === "rejected" && !rejectionReason) {
		dom.participantReviewStatus.className = "mt-3 text-sm font-bold text-red-600";
		dom.participantReviewStatus.textContent = "Please enter a rejection reason before rejecting.";
		dom.participantRejectionReason.focus();
		return;
	}
	const adminUser = getStoredAdminUser();
	const updateData = {
		status: normalizedStatus,
		reviewed_by: adminUser?.id || adminUser?.email || null,
		reviewed_by_name: adminUser?.fullName || adminUser?.full_name || adminUser?.email || "Admin",
		reviewed_at: new Date().toISOString(),
		rejection_reason: normalizedStatus === "rejected" ? rejectionReason : null
	};
	dom.participantReviewStatus.className = "mt-3 text-sm font-bold text-blue-700";
	dom.participantReviewStatus.textContent = "Saving review...";
	const { error } = await supabase
		.from(PARTICIPANTS_TABLE)
		.update(updateData)
		.eq("id", state.activeParticipantDetailsId);
	if (error) {
		console.error("Participant review update error:", error.message || error);
		dom.participantReviewStatus.className = "mt-3 text-sm font-bold text-red-600";
		dom.participantReviewStatus.textContent = error.message || "Failed to update participant review.";
		return;
	}
	dom.participantReviewStatus.className = "mt-3 text-sm font-bold text-green-700";
	dom.participantReviewStatus.textContent = "Participant review updated.";
	await Promise.all([
		loadParticipants(),
		loadAdminOverviewCounts()
	]);
	const updatedParticipant = state.participantsData.find(participant => String(participant.id) === String(state.activeParticipantDetailsId));
	if (updatedParticipant) {
		openParticipantDetailsModal(updatedParticipant);
	}
}
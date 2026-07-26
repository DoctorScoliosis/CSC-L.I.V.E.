/*
 * Participant Checker + attendance verification for the Committee dashboard.
 *
 * Two independent checkers live here:
 *   - Participant Checker: looks up a Student ID in the participants table
 *     and reports whether they're registered and approved to play.
 *   - Verify Attendance: confirms whether a registered participant has a
 *     Present attendance record for today.
 *
 * These are read-only — they never write to the database.
 */

import {
	dom,
	supabase,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE
} from "../pages/committee-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTimeShort as formatDateTime } from "../utils/datetime.js";
import { normalizeStatus } from "../utils/normalize.js";
import { getLocalISODate } from "../utils/datetime.js";

function getParticipantDisplayName(participant) {
	return participant?.full_name || participant?.name || participant?.participant_name || "No name";
}

function getParticipantTeamName(participant) {
	return participant?.team_name || participant?.team || "No team";
}

function getParticipantIdNumber(participant) {
	return participant?.id_number || participant?.student_id || "-";
}

function getParticipantGameScopeLabel(participant) {
	const scope = String(participant?.game_scope || "").trim().toLowerCase();
	if (scope === "major") return "Major game only";
	if (scope === "minor") return "Minor game only";
	if (scope === "both") return "Both major and minor game";
	return participant?.game_scope || "-";
}

function getParticipantImportLabel(participant) {
	return participant?.is_import ? "Yes" : "No";
}

function getParticipantApprovalLabel(status) {
	const normalizedStatus = normalizeStatus(status || "pending");
	if (normalizedStatus === "approved") return "Approved";
	if (normalizedStatus === "rejected") return "Rejected";
	return "Pending";
}

function setParticipantCheckResult(type, htmlContent) {
	dom.participantCheckResult.className = "rounded-lg border p-6";
	if (type === "registered") {
		dom.participantCheckResult.classList.add("bg-green-50", "border-green-200", "text-green-900");
	} else if (type === "not-allowed") {
		dom.participantCheckResult.classList.add("bg-amber-50", "border-amber-200", "text-amber-950");
	} else if (type === "missing") {
		dom.participantCheckResult.classList.add("bg-red-50", "border-red-200", "text-red-900");
	} else {
		dom.participantCheckResult.classList.add("bg-gray-50", "border-gray-200", "text-gray-600");
	}
	dom.participantCheckResult.innerHTML = htmlContent;
}

export function clearParticipantCheck() {
	dom.participantCheckStudentId.value = "";
	setParticipantCheckResult("neutral", `
	Enter a student ID to check if the participant is registered.
	`);
	setTimeout(() => dom.participantCheckStudentId.focus(), 50);
}

export async function checkParticipantRegistration(event) {
	event.preventDefault();
	const studentId = dom.participantCheckStudentId.value.trim();
	const submitButton = dom.participantCheckForm.querySelector('button[type="submit"]');
	if (!studentId) {
		setParticipantCheckResult("missing", `
		<p class="text-lg font-bold">Student ID is required.</p>
		<p>Please enter a student ID before checking registration.</p>
		`);
		dom.participantCheckStudentId.focus();
		return;
	}
	submitButton.disabled = true;
	submitButton.textContent = "Checking...";
	try {
		const { data: participant, error } = await supabase
			.from(PARTICIPANTS_TABLE)
			.select("*")
			.eq("student_id", studentId)
			.maybeSingle();
		if (error) {
			throw error;
		}
		if (!participant) {
			setParticipantCheckResult("missing", `
			<div class="space-y-3">
			<p class="text-2xl font-bold">Participant is not registered.</p>
			<p>No participant record matched Student ID <strong>${escapeHTML(studentId)}</strong>.</p>
			</div>
			`);
			dom.participantCheckForm.reset();
			setTimeout(() => dom.participantCheckStudentId.focus(), 50);
			return;
		}
		const participantStatus = normalizeStatus(participant.status || "pending");
		const isApprovedParticipant = participantStatus === "approved";
		const statusLabel = getParticipantApprovalLabel(participant.status);
		const resultType = isApprovedParticipant ? "registered" : "not-allowed";
		const statusTextClass = isApprovedParticipant ? "text-green-700" : participantStatus === "rejected" ? "text-red-700" : "text-amber-700";
		const resultTitle = isApprovedParticipant
			? "Participant is registered and allowed to play."
			: `Participant is ${statusLabel.toLowerCase()} and not allowed to play.`;
		const resultSubtitle = isApprovedParticipant
			? "Registration record is approved in the participants database."
			: "This participant must be approved by admin before joining any game.";
		const detailBorderClass = isApprovedParticipant ? "border-green-100" : "border-amber-100";
		const detailLabelClass = isApprovedParticipant ? "text-green-700" : "text-amber-700";
		setParticipantCheckResult(resultType, `
		<div class="space-y-4">
		<div>
		<p class="text-2xl font-bold">${escapeHTML(resultTitle)}</p>
		<p class="text-sm">${escapeHTML(resultSubtitle)}</p>
		</div>
		${!isApprovedParticipant ? `
		<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
		<p class="text-sm font-black uppercase tracking-wide">Not Allowed to Play</p>
		<p class="mt-1 text-sm font-semibold">Current status: ${escapeHTML(statusLabel)}</p>
		</div>
		` : ""}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white bg-opacity-80 rounded-lg p-4 border ${detailBorderClass}">
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Name</p>
		<p class="font-semibold">${escapeHTML(getParticipantDisplayName(participant))}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Student ID</p>
		<p class="font-semibold">${escapeHTML(getParticipantIdNumber(participant))}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Team</p>
		<p class="font-semibold">${escapeHTML(getParticipantTeamName(participant))}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Status</p>
		<p class="font-semibold ${statusTextClass}">${escapeHTML(statusLabel)}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Course</p>
		<p class="font-semibold">${escapeHTML(participant.course || "-")}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Playing In</p>
		<p class="font-semibold">${escapeHTML(getParticipantGameScopeLabel(participant))}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Major Sport</p>
		<p class="font-semibold">${escapeHTML(participant.major_sport_name || "-")}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Minor Sport</p>
		<p class="font-semibold">${escapeHTML(participant.minor_sport_name || "-")}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Import Player</p>
		<p class="font-semibold">${escapeHTML(getParticipantImportLabel(participant))}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide ${detailLabelClass}">Registered At</p>
		<p class="font-semibold">${escapeHTML(formatDateTime(participant.created_at))}</p>
		</div>
		</div>
		</div>
		`);
		dom.participantCheckForm.reset();
		setTimeout(() => dom.participantCheckStudentId.focus(), 50);
	} catch (err) {
		console.error("Participant checker error:", err.message || err);
		setParticipantCheckResult("missing", `
		<p class="text-lg font-bold">Failed to check participant.</p>
		<p>${escapeHTML(err.message || "Please check the participants table and RLS policies.")}</p>
		`);
		setTimeout(() => dom.participantCheckStudentId.focus(), 50);
	} finally {
		submitButton.disabled = false;
		submitButton.textContent = "Check Registration";
	}
}

function setVerificationResult(type, htmlContent) {
	dom.verifyAttendanceResult.className = "rounded-lg border p-6";
	if (type === "allowed") {
		dom.verifyAttendanceResult.classList.add("bg-green-50", "border-green-200", "text-green-900");
	} else if (type === "denied") {
		dom.verifyAttendanceResult.classList.add("bg-red-50", "border-red-200", "text-red-900");
	} else {
		dom.verifyAttendanceResult.classList.add("bg-gray-50", "border-gray-200", "text-gray-600");
	}
	dom.verifyAttendanceResult.innerHTML = htmlContent;
}

export function clearVerifyResult() {
	dom.verifyStudentId.value = "";
	setVerificationResult("neutral", `
	Enter a student ID to verify if the participant attended today.
	`);
	setTimeout(() => dom.verifyStudentId.focus(), 50);
}

export async function verifyParticipantAttendance(event) {
	event.preventDefault();
	const studentId = dom.verifyStudentId.value.trim();
	const submitButton = dom.verifyAttendanceForm.querySelector('button[type="submit"]');
	if (!studentId) {
		setVerificationResult("denied", `
		<p class="text-lg font-bold">Student ID is required.</p>
		<p>Please enter a student ID before checking.</p>
		`);
		dom.verifyStudentId.focus();
		return;
	}
	submitButton.disabled = true;
	submitButton.textContent = "Checking...";
	try {
		const { data: participant, error: participantError } = await supabase
			.from(PARTICIPANTS_TABLE)
			.select("id, name, student_id, team, home_college, import_college, status")
			.eq("student_id", studentId)
			.maybeSingle();
		if (participantError) {
			throw participantError;
		}
		if (!participant) {
			setVerificationResult("denied", `
			<div class="space-y-3">
			<p class="text-2xl font-bold">Participant is not registered.</p>
			<p>No registered participant matched Student ID <strong>${escapeHTML(studentId)}</strong>.</p>
			</div>
			`);
			dom.verifyAttendanceForm.reset();
			setTimeout(() => dom.verifyStudentId.focus(), 50);
			return;
		}
		const today = getLocalISODate();
		const { data: attendance, error: attendanceError } = await supabase
			.from(ATTENDANCE_TABLE)
			.select("id, student_id, participant_name, team, home_college, status, attendance_date, checked_at")
			.eq("student_id", participant.student_id)
			.eq("attendance_date", today)
			.maybeSingle();
		if (attendanceError) {
			throw attendanceError;
		}
		const attendanceStatus = attendance?.status || "Not Present";
		const isPresent = normalizeStatus(attendanceStatus) === "present";
		if (isPresent) {
			setVerificationResult("allowed", `
			<div class="space-y-4">
			<div>
			<p class="text-2xl font-bold">Participant attendance is verified.</p>
			<p class="text-sm">Attendance is marked <strong>Present</strong> for today.</p>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white bg-opacity-80 rounded-lg p-4 border border-green-100">
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Name</p>
			<p class="font-semibold">${escapeHTML(participant.name || "No name")}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Student ID</p>
			<p class="font-semibold">${escapeHTML(participant.student_id)}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Home College</p>
			<p class="font-semibold">${escapeHTML(participant.home_college || attendance?.home_college || participant.team || "No college")}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Team to Join</p>
			<p class="font-semibold">${escapeHTML(participant.team || "No team")}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Attendance Status</p>
			<p class="font-semibold">${escapeHTML(attendanceStatus)}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Attendance Date</p>
			<p class="font-semibold">${escapeHTML(attendance?.attendance_date || today)}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-green-700">Checked At</p>
			<p class="font-semibold">${escapeHTML(formatDateTime(attendance?.checked_at))}</p>
			</div>
			</div>
			<p class="text-xs text-green-700">Ready for the next verification. Enter another Student ID.</p>
			</div>
			`);
		} else {
			setVerificationResult("denied", `
			<div class="space-y-4">
			<div>
			<p class="text-2xl font-bold">Participant attendance is not verified.</p>
			<p class="text-sm">Attendance is not marked <strong>Present</strong> for today.</p>
			</div>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white bg-opacity-80 rounded-lg p-4 border border-red-100">
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Name</p>
			<p class="font-semibold">${escapeHTML(participant.name || "No name")}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Student ID</p>
			<p class="font-semibold">${escapeHTML(participant.student_id)}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Home College</p>
			<p class="font-semibold">${escapeHTML(participant.home_college || attendance?.home_college || participant.team || "No college")}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Team to Join</p>
			<p class="font-semibold">${escapeHTML(participant.team || "No team")}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Attendance Status</p>
			<p class="font-semibold">${escapeHTML(attendanceStatus)}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Attendance Date</p>
			<p class="font-semibold">${escapeHTML(attendance?.attendance_date || today)}</p>
			</div>
			<div>
			<p class="text-xs uppercase tracking-wide text-red-700">Reason</p>
			<p class="font-semibold">${attendance ? "Status is not Present" : "No attendance record for today"}</p>
			</div>
			</div>
			<p class="text-xs text-red-700">Ready for the next verification. Enter another Student ID.</p>
			</div>
			`);
		}
		dom.verifyAttendanceForm.reset();
		setTimeout(() => dom.verifyStudentId.focus(), 50);
	} catch (err) {
		console.error("Verify attendance error:", err.message || err);
		setVerificationResult("denied", `
		<p class="text-lg font-bold">Failed to verify attendance.</p>
		<p>${escapeHTML(err.message || "Please check the participants and attendance table columns/RLS policies.")}</p>
		`);
		setTimeout(() => dom.verifyStudentId.focus(), 50);
	} finally {
		submitButton.disabled = false;
		submitButton.textContent = "Verify Attendance";
	}
}
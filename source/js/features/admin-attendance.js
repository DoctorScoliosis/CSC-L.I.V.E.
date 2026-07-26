/*
 * Attendance Checker tab for the Admin dashboard.
 *
 * Looks up a participant by Student ID and upserts a Present attendance
 * record (one per student per day). Also surfaces the home-college daily
 * bonus progress: 100 present records in a day earns that college +5
 * leaderboard points.
 */

import {
	dom,
	supabase,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE
} from "./admin-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime, getLocalISODate } from "../utils/datetime.js";
import { normalizeStatus } from "../utils/normalize.js";
import { loadAdminOverviewCounts } from "./admin-overview.js";

function showAttendanceResult(type, content) {
	if (dom.attendanceEmptyState) {
		dom.attendanceEmptyState.classList.add("hidden");
	}
	dom.attendanceResult.classList.remove(
		"hidden",
		"bg-green-50",
		"border-green-200",
		"text-green-900",
		"bg-red-50",
		"border-red-200",
		"text-red-900",
		"bg-yellow-50",
		"border-yellow-200",
		"text-yellow-900"
	);
	if (type === "success") {
		dom.attendanceResult.classList.add("bg-green-50", "border-green-200", "text-green-900");
	} else if (type === "error") {
		dom.attendanceResult.classList.add("bg-red-50", "border-red-200", "text-red-900");
	} else {
		dom.attendanceResult.classList.add("bg-yellow-50", "border-yellow-200", "text-yellow-900");
	}
	dom.attendanceResult.innerHTML = content;
}

export function clearAttendanceResult() {
	dom.attendanceResult.innerHTML = "";
	dom.attendanceResult.className = "hidden rounded-lg border p-4 text-sm";
	if (dom.attendanceEmptyState) {
		dom.attendanceEmptyState.classList.remove("hidden");
	}
}

export async function checkAttendance(event) {
	event.preventDefault();
	const studentId = dom.attendanceStudentId.value.trim();
	const submitButton = dom.attendanceForm.querySelector('button[type="submit"]');
	if (!studentId) {
		showAttendanceResult("error", `
		<p class="font-semibold">Student ID is required.</p>
		<p>Please enter a Student ID before checking attendance.</p>
		`);
		dom.attendanceStudentId.focus();
		return;
	}
	submitButton.disabled = true;
	submitButton.textContent = "Checking...";
	try {
		const { data: participant, error: lookupError } = await supabase
			.from(PARTICIPANTS_TABLE)
			.select("id, name, student_id, team, home_college, status")
			.eq("student_id", studentId)
			.maybeSingle();
		if (lookupError) {
			throw lookupError;
		}
		if (!participant) {
			showAttendanceResult("error", `
			<p class="font-semibold">Student ID not found.</p>
			<p>No registered participant matched <strong>${escapeHTML(studentId)}</strong>.</p>
			`);
			dom.attendanceForm.reset();
			setTimeout(() => dom.attendanceStudentId.focus(), 50);
			return;
		}
		const attendanceCollege = participant.home_college || participant.team || "";
		const attendanceRecord = {
			participant_id: participant.id,
			student_id: participant.student_id,
			participant_name: participant.name || "",
			team: attendanceCollege,
			home_college: attendanceCollege,
			status: "Present",
			checked_at: new Date().toISOString()
		};
		const { data: savedAttendance, error: attendanceError } = await supabase
			.from(ATTENDANCE_TABLE)
			.upsert([attendanceRecord], {
				onConflict: "student_id,attendance_date"
			})
			.select("id, participant_id, student_id, participant_name, team, home_college, status, attendance_date, checked_at")
			.single();
		if (attendanceError) {
			throw attendanceError;
		}
		const attendanceDate = savedAttendance?.attendance_date || getLocalISODate();
		let attendanceBonusNotice = "";
		if (attendanceCollege) {
			const { count: teamAttendanceCount, error: teamAttendanceError } = await supabase
				.from(ATTENDANCE_TABLE)
				.select("student_id", { count: "exact", head: true })
				.eq("attendance_date", attendanceDate)
				.eq("home_college", attendanceCollege)
				.eq("status", "Present");
			if (teamAttendanceError) {
				console.warn("Unable to count team attendance bonus:", teamAttendanceError.message || teamAttendanceError);
			} else {
				const remainingAttendance = Math.max(0, 100 - Number(teamAttendanceCount || 0));
				attendanceBonusNotice = Number(teamAttendanceCount || 0) >= 100
					? `<p class="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800">Daily home college attendance bonus active: ${escapeHTML(attendanceCollege)} has ${Number(teamAttendanceCount || 0).toLocaleString()} present records today, so +5 points will be added to the leaderboard.</p>`
					: `<p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">${escapeHTML(attendanceCollege)} has ${Number(teamAttendanceCount || 0).toLocaleString()}/100 present records today. ${remainingAttendance.toLocaleString()} more needed for the +5 daily home college bonus.</p>`;
			}
		}
		showAttendanceResult("success", `
		<div class="space-y-3">
		<div>
		<p class="text-lg font-bold">Participant attendance checked.</p>
		<p class="text-sm">The participant has been marked <strong>Present</strong> in the attendance table.</p>
		</div>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white bg-opacity-70 rounded-lg p-3 border border-green-100">
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
		<p class="font-semibold">${escapeHTML(attendanceCollege || "No college")}</p>
		</div>
		<div>
		<p class="text-xs uppercase tracking-wide text-green-700">Attendance</p>
		<p class="font-semibold">${escapeHTML(savedAttendance?.status || "Present")}</p>
		</div>
		<div class="sm:col-span-2">
		<p class="text-xs uppercase tracking-wide text-green-700">Checked At</p>
		<p class="font-semibold">${escapeHTML(formatDateTime(savedAttendance?.checked_at || attendanceRecord.checked_at))}</p>
		</div>
		</div>
		${attendanceBonusNotice}
		<p class="text-xs text-green-700">Ready for the next attendance check. Enter another Student ID or close this window.</p>
		</div>
		`);
		await loadAdminOverviewCounts();
		dom.attendanceForm.reset();
		setTimeout(() => dom.attendanceStudentId.focus(), 50);
	} catch (err) {
		console.error("Attendance check error:", err.message || err);
		showAttendanceResult("error", `
		<p class="font-semibold">Failed to save attendance.</p>
		<p>${escapeHTML(err.message || "Please check your attendance table, columns, unique constraint, and RLS policy.")}</p>
		`);
		setTimeout(() => dom.attendanceStudentId.focus(), 50);
	} finally {
		submitButton.disabled = false;
		submitButton.textContent = "Check Attendance";
	}
}
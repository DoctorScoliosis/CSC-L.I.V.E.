/*
 * Date and time helpers shared by every page.
 *
 * IMPORTANT — there are TWO display formats on purpose:
 *   formatDateTime       -> full locale string, used by the Admin dashboard
 *   formatDateTimeShort  -> medium date + short time, used by the Committee
 *                          and Student dashboards
 * They produce visibly different output. When wiring a page in Tier 3,
 * import the one that page uses TODAY (check the baseline if unsure).
 * Do not merge them.
 */

// Admin flavour: full locale date and time, e.g. "7/26/2026, 3:41:22 PM".
export function formatDateTime(value) {
	if (!value) {
		return "-";
	}
	const dateValue = new Date(value);
	if (Number.isNaN(dateValue.getTime())) {
		return "-";
	}
	return dateValue.toLocaleString();
}

// Committee/Student flavour: e.g. "Jul 26, 2026, 3:41 PM".
export function formatDateTimeShort(value) {
	if (!value) {
		return "-";
	}
	const dateValue = new Date(value);
	if (Number.isNaN(dateValue.getTime())) {
		return "-";
	}
	return dateValue.toLocaleString([], {
		dateStyle: "medium",
		timeStyle: "short"
	});
}

// Formats a date for a <input type="datetime-local"> field, in local time.
export function formatDateTimeLocalInput(value) {
	if (!value) {
		return "";
	}
	const dateValue = new Date(value);
	if (Number.isNaN(dateValue.getTime())) {
		return "";
	}
	const offsetMs = dateValue.getTimezoneOffset() * 60000;
	return new Date(dateValue.getTime() - offsetMs).toISOString().slice(0, 16);
}

// Reads a <input type="datetime-local"> field and returns an ISO string,
// or null when the field is empty or invalid.
export function getDateTimeLocalInputISO(input) {
	const rawValue = input?.value || "";
	if (!rawValue) {
		return null;
	}
	const dateValue = new Date(rawValue);
	return Number.isNaN(dateValue.getTime()) ? null : dateValue.toISOString();
}

// Today's date in local time as "YYYY-MM-DD" (Canada format sorts nicely
// and matches the attendance_date column format).
export function getLocalISODate() {
	return new Date().toLocaleDateString("en-CA");
}

// --- Match timers ------------------------------------------------------------
// The committee dashboard starts countdown timers on matches and the
// student dashboard displays them. Both use these three helpers unchanged.

export function clampTimerSeconds(value) {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

// 95 -> "01:35"
export function formatTimerDisplay(totalSeconds) {
	const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Works out how many seconds are left on a match's countdown, based on
// when the committee started it. Returns the full duration when the timer
// has not been started yet.
export function calculateRemainingSeconds(match) {
	const duration = clampTimerSeconds(match.timer_duration_seconds) || 600;
	if (!match.timer_enabled || !match.timer_started_at) {
		return duration;
	}
	const startedAt = new Date(match.timer_started_at).getTime();
	if (Number.isNaN(startedAt)) {
		return duration;
	}
	const elapsed = Math.floor((Date.now() - startedAt) / 1000);
	return Math.max(duration - elapsed, 0);
}
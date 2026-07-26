/*
 * Idle-aware auto-refresh scheduling for the Student dashboard.
 *
 * The page refreshes its data on three triggers: a 15s fallback poll,
 * Supabase realtime events, and tab visibility changes. To avoid yanking
 * data mid-typing or mid-modal, every reload is routed through the
 * schedulers here, which defer the work until the student is idle
 * (no focused field, no dirty form, no open modal, no recent interaction).
 *
 * Also owns loadStats — the header counter refresh. The student header no
 * longer renders those counters (the elements don't exist), so the loads
 * are kept for refresh-behaviour parity but the results are voided.
 */

import {
	supabase,
	state,
	dom,
	TEAMS_TABLE,
	MATCHES_TABLE,
	PARTICIPANTS_TABLE,
	STUDENT_REFRESH_IDLE_DELAY
} from "../pages/student-context.js";
import { loadMatches, loadSportCategoryFilterOptions } from "./student-matches.js";
import { loadLeaderboard } from "./student-leaderboard.js";
import { refreshStudentAnnouncements } from "./student-announcements.js";

// --- Idle tracking -----------------------------------------------------------

function trackStudentInteraction(event) {
	state.studentLastInteractionAt = Date.now();
	if (event.type === "input" || event.type === "change") {
		event.target.closest("form")?.setAttribute("data-auto-refresh-dirty", "true");
	}
}

function clearStudentDirtyForm(event) {
	event.target.removeAttribute("data-auto-refresh-dirty");
}

function isStudentUserBusy() {
	const activeElement = document.activeElement;
	const isEditingField = activeElement?.matches("input, textarea, select, [contenteditable='true']");
	const hasDirtyForm = Boolean(document.querySelector("form[data-auto-refresh-dirty='true']"));
	const hasOpenModal = [...document.querySelectorAll("[id$='Modal']")]
		.some(modal => !modal.classList.contains("hidden"));
	return Boolean(isEditingField)
		|| hasDirtyForm
		|| hasOpenModal
		|| Date.now() - state.studentLastInteractionAt < STUDENT_REFRESH_IDLE_DELAY;
}

export function initStudentInteractionTracking() {
	document.addEventListener("input", trackStudentInteraction, true);
	document.addEventListener("change", trackStudentInteraction, true);
	document.addEventListener("pointerdown", trackStudentInteraction, true);
	document.addEventListener("keydown", trackStudentInteraction, true);
	document.addEventListener("submit", clearStudentDirtyForm, true);
	document.addEventListener("reset", clearStudentDirtyForm, true);
}

// --- Reload schedulers -------------------------------------------------------

export function scheduleLiveMatchReload(delay = 250, { force = false } = {}) {
	window.clearTimeout(state.matchReloadTimer);
	state.matchReloadTimer = window.setTimeout(async () => {
		if (!force && isStudentUserBusy()) {
			scheduleLiveMatchReload(STUDENT_REFRESH_IDLE_DELAY);
			return;
		}
		await Promise.all([
			loadStats(),
			loadMatches({ showLoading: false })
		]);
	}, delay);
}

export function scheduleLiveLeaderboardReload(delay = 250, { force = false } = {}) {
	window.clearTimeout(state.leaderboardReloadTimer);
	state.leaderboardReloadTimer = window.setTimeout(async () => {
		if (!force && isStudentUserBusy()) {
			scheduleLiveLeaderboardReload(STUDENT_REFRESH_IDLE_DELAY);
			return;
		}
		await Promise.all([
			loadStats(),
			loadLeaderboard({ showLoading: false })
		]);
	}, delay);
}

export function scheduleStudentSupplementalReload(tasks, delay = 250) {
	Object.assign(state.pendingStudentSupplementalReloads, {
		sports: state.pendingStudentSupplementalReloads.sports || Boolean(tasks.sports),
		announcements: state.pendingStudentSupplementalReloads.announcements || Boolean(tasks.announcements),
		showAnnouncementPopup: state.pendingStudentSupplementalReloads.showAnnouncementPopup || Boolean(tasks.showAnnouncementPopup)
	});
	window.clearTimeout(state.studentSupplementalReloadTimer);
	state.studentSupplementalReloadTimer = window.setTimeout(async () => {
		if (isStudentUserBusy()) {
			scheduleStudentSupplementalReload({}, STUDENT_REFRESH_IDLE_DELAY);
			return;
		}
		const reloads = [];
		if (state.pendingStudentSupplementalReloads.sports) reloads.push(loadSportCategoryFilterOptions());
		if (state.pendingStudentSupplementalReloads.announcements) {
			reloads.push(refreshStudentAnnouncements({
				showPopup: state.pendingStudentSupplementalReloads.showAnnouncementPopup
			}));
		}
		state.pendingStudentSupplementalReloads.sports = false;
		state.pendingStudentSupplementalReloads.announcements = false;
		state.pendingStudentSupplementalReloads.showAnnouncementPopup = false;
		await Promise.all(reloads);
	}, delay);
}

// --- Header counters (kept for parity, results voided) -----------------------

async function countRows(tableName) {
	const { count, error } = await supabase
		.from(tableName)
		.select("*", { count: "exact", head: true });
	if (error) {
		console.error(`Error counting ${tableName}:`, error.message || error);
		return 0;
	}
	return count || 0;
}

export async function loadStats() {
	const [totalTeams, totalMatches, totalParticipants] = await Promise.all([
		countRows(TEAMS_TABLE),
		countRows(MATCHES_TABLE),
		countRows(PARTICIPANTS_TABLE)
	]);
	// The student header no longer renders these counters, but the loads are
	// kept to preserve the original refresh behaviour.
	void totalTeams; void totalMatches; void totalParticipants;
	void dom.studentTotalTeams; void dom.studentTotalMatches; void dom.studentTotalParticipants;
}
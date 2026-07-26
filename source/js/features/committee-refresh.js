/*
 * Idle-aware refresh + reload scheduling for the Committee dashboard.
 *
 * Owns ALL the timing and refresh behaviour, so committee.js stays pure
 * wiring:
 *   - interaction tracking, so data is never yanked mid-typing, mid-modal,
 *     or while a form is dirty
 *   - scheduleCommitteeRealtimeReload — batches reload tasks fired by the
 *     Supabase realtime handlers into one debounced pass
 *   - scheduleCommitteeFallbackSync — periodic full refresh (also runs when
 *     the tab becomes visible again)
 *   - scheduleCommitteeMessagingReload — debounced conversation/message sync
 *   - the poll intervals and the visibilitychange handler
 *
 * committee.js calls initCommitteeRefresh() once after the initial load.
 * Its realtime handlers call the exported schedule functions — the handler
 * code itself does not change, only where the functions are defined.
 */

import { state } from "../pages/committee-context.js";
import { loadOverviewCounts, loadCommitteeAnnouncements } from "./committee-overview.js";
import { loadLeaderboard, refreshCommitteeLeaderboard } from "./committee-leaderboard.js";
import {
	loadSportsForMatches,
	loadRegisteredTeams,
	loadSavedMatches,
	updateCountdownDisplays
} from "./committee-matches.js";
import {
	loadContactPersonnel,
	loadContactMessages,
	loadCommitteeConversations
} from "./committee-chat.js";

const COMMITTEE_REFRESH_IDLE_DELAY = 1200;

let committeeLastInteractionAt = 0;
let committeeRealtimeReloadTimer = null;
let committeeMessagingSyncInProgress = false;
let committeeRealtimeMessagingTimer = null;

const pendingCommitteeReloads = {
	overview: false,
	leaderboard: false,
	sports: false,
	teams: false,
	matches: false,
	announcements: false,
	contacts: false,
	contactMessages: false,
	conversations: false
};

// --- Interaction tracking ----------------------------------------------------
function trackCommitteeInteraction(event) {
	committeeLastInteractionAt = Date.now();
	if (event.type === "input" || event.type === "change") {
		event.target.closest("form")?.setAttribute("data-auto-refresh-dirty", "true");
	}
}

function clearCommitteeDirtyForm(event) {
	event.target.removeAttribute("data-auto-refresh-dirty");
}

function isCommitteeUserBusy() {
	const activeElement = document.activeElement;
	const isEditingField = activeElement?.matches("input, textarea, select, [contenteditable='true']");
	const hasDirtyForm = Boolean(document.querySelector("form[data-auto-refresh-dirty='true']"));
	const hasOpenModal = [...document.querySelectorAll("[id$='Modal']")]
		.some(modal => !modal.classList.contains("hidden"));
	return Boolean(isEditingField)
		|| hasDirtyForm
		|| hasOpenModal
		|| Date.now() - committeeLastInteractionAt < COMMITTEE_REFRESH_IDLE_DELAY;
}

// --- Batched realtime reloads ------------------------------------------------
export function scheduleCommitteeRealtimeReload(tasks, delay = 250, options = {}) {
	Object.assign(pendingCommitteeReloads, tasks);
	window.clearTimeout(committeeRealtimeReloadTimer);
	committeeRealtimeReloadTimer = window.setTimeout(async () => {
		if (!options.force && isCommitteeUserBusy()) {
			scheduleCommitteeRealtimeReload({}, COMMITTEE_REFRESH_IDLE_DELAY);
			return;
		}
		const reloads = [];
		if (pendingCommitteeReloads.overview) reloads.push(loadOverviewCounts());
		if (pendingCommitteeReloads.leaderboard) reloads.push(loadLeaderboard());
		if (pendingCommitteeReloads.sports) reloads.push(loadSportsForMatches());
		if (pendingCommitteeReloads.teams) reloads.push(loadRegisteredTeams());
		if (pendingCommitteeReloads.matches) reloads.push(loadSavedMatches());
		if (pendingCommitteeReloads.announcements) reloads.push(loadCommitteeAnnouncements());
		if (pendingCommitteeReloads.contacts) reloads.push(loadContactPersonnel());
		if (pendingCommitteeReloads.contactMessages) reloads.push(loadContactMessages());
		if (pendingCommitteeReloads.conversations) reloads.push(loadCommitteeConversations());
		Object.keys(pendingCommitteeReloads).forEach(key => {
			pendingCommitteeReloads[key] = false;
		});
		await Promise.all(reloads);
	}, delay);
}

export function scheduleCommitteeFallbackSync() {
	scheduleCommitteeRealtimeReload({
		overview: true,
		leaderboard: true,
		sports: true,
		teams: true,
		matches: true,
		announcements: true,
		contacts: true,
		conversations: true,
		contactMessages: Boolean(state.activeContactConversationId)
	}, 0);
}

// --- Messaging sync ----------------------------------------------------------
export function scheduleCommitteeMessagingReload({ contactMessages = false, conversations = true } = {}, delay = 100) {
	window.clearTimeout(committeeRealtimeMessagingTimer);
	committeeRealtimeMessagingTimer = window.setTimeout(async () => {
		if (committeeMessagingSyncInProgress) {
			scheduleCommitteeMessagingReload({ contactMessages, conversations }, delay);
			return;
		}
		committeeMessagingSyncInProgress = true;
		try {
			const reloads = [];
			if (conversations) reloads.push(loadCommitteeConversations());
			if (contactMessages && state.activeContactConversationId) reloads.push(loadContactMessages());
			await Promise.all(reloads);
		} finally {
			committeeMessagingSyncInProgress = false;
		}
	}, delay);
}

// --- Wiring ------------------------------------------------------------------
export function initCommitteeRefresh() {
	document.addEventListener("input", trackCommitteeInteraction, true);
	document.addEventListener("change", trackCommitteeInteraction, true);
	document.addEventListener("pointerdown", trackCommitteeInteraction, true);
	document.addEventListener("keydown", trackCommitteeInteraction, true);
	document.addEventListener("submit", clearCommitteeDirtyForm, true);
	document.addEventListener("reset", clearCommitteeDirtyForm, true);

	// Periodic polls. The announcements / leaderboard / countdown ticks are
	// lightweight high-frequency refreshes; the fallback sync is the full
	// sweep that catches anything realtime missed.
	setInterval(() => scheduleCommitteeRealtimeReload({ overview: true }), 10000);
	setInterval(loadCommitteeAnnouncements, 2000);
	setInterval(refreshCommitteeLeaderboard, 2000);
	setInterval(updateCountdownDisplays, 1000);
	setInterval(scheduleCommitteeFallbackSync, 15000);
	setInterval(async () => {
		if (committeeMessagingSyncInProgress) return;
		committeeMessagingSyncInProgress = true;
		try {
			await loadCommitteeConversations();
			if (state.activeContactConversationId) {
				await loadContactMessages();
			}
		} finally {
			committeeMessagingSyncInProgress = false;
		}
	}, 5000);

	document.addEventListener("visibilitychange", function () {
		if (!document.hidden) {
			scheduleCommitteeFallbackSync();
		}
	});
}
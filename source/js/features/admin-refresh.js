/*
 * Idle-aware refresh scheduling for the Admin dashboard.
 *
 * Owns all the timing and reload batching so admin.js stays a pure wiring
 * layer. Reloads are deferred while the admin is typing, has a dirty form,
 * or has a modal open, so realtime events never yank data mid-edit.
 */

import { state } from "../pages/admin-context.js";
import { loadAdminOverviewCounts } from "./admin-overview.js";
import { loadTeams } from "./admin-teams.js";
import { loadSports } from "./admin-sports.js";
import { loadParticipants } from "./admin-participants.js";
import { loadStudentFeedback } from "./admin-feedback.js";
import { loadAnnouncements } from "./admin-announcements.js";
import { loadAccountApprovals } from "./admin-accounts.js";
import { loadAdminContactProfiles } from "./admin-chat-contacts.js";
import { loadAdminContactMessages, loadAdminConversations } from "./admin-chat-thread.js";

const ADMIN_REFRESH_IDLE_DELAY = 1200;

let adminLastInteractionAt = 0;
let adminRealtimeReloadTimer = null;
let adminMessagingSyncInProgress = false;
let adminRealtimeMessagingTimer = null;

const pendingAdminReloads = {
	teams: false,
	sports: false,
	participants: false,
	overview: false,
	feedback: false,
	announcements: false,
	accounts: false,
	contacts: false,
	contactMessages: false,
	conversations: false
};

function trackAdminInteraction(event) {
	adminLastInteractionAt = Date.now();
	if (event.type === "input" || event.type === "change") {
		event.target.closest("form")?.setAttribute("data-auto-refresh-dirty", "true");
	}
}

function clearAdminDirtyForm(event) {
	event.target.removeAttribute("data-auto-refresh-dirty");
}

function isAdminUserBusy() {
	const activeElement = document.activeElement;
	const isEditingField = activeElement?.matches("input, textarea, select, [contenteditable='true']");
	const hasDirtyForm = Boolean(document.querySelector("form[data-auto-refresh-dirty='true']"));
	const hasOpenModal = [...document.querySelectorAll("[id$='Modal']")]
		.some(modal => !modal.classList.contains("hidden"));
	return Boolean(isEditingField)
		|| hasDirtyForm
		|| hasOpenModal
		|| Date.now() - adminLastInteractionAt < ADMIN_REFRESH_IDLE_DELAY;
}

export function initAdminInteractionTracking() {
	document.addEventListener("input", trackAdminInteraction, true);
	document.addEventListener("change", trackAdminInteraction, true);
	document.addEventListener("pointerdown", trackAdminInteraction, true);
	document.addEventListener("keydown", trackAdminInteraction, true);
	document.addEventListener("submit", clearAdminDirtyForm, true);
	document.addEventListener("reset", clearAdminDirtyForm, true);
}

export function scheduleAdminRealtimeReload(tasks, delay = 250, options = {}) {
	Object.assign(pendingAdminReloads, tasks);
	window.clearTimeout(adminRealtimeReloadTimer);
	adminRealtimeReloadTimer = window.setTimeout(async () => {
		if (!options.force && isAdminUserBusy()) {
			scheduleAdminRealtimeReload({}, ADMIN_REFRESH_IDLE_DELAY);
			return;
		}
		const reloads = [];
		if (pendingAdminReloads.teams) reloads.push(loadTeams());
		if (pendingAdminReloads.sports) reloads.push(loadSports());
		if (pendingAdminReloads.participants) reloads.push(loadParticipants());
		if (pendingAdminReloads.overview) reloads.push(loadAdminOverviewCounts());
		if (pendingAdminReloads.feedback) reloads.push(loadStudentFeedback());
		if (pendingAdminReloads.announcements) reloads.push(loadAnnouncements());
		if (pendingAdminReloads.accounts) reloads.push(loadAccountApprovals());
		if (pendingAdminReloads.contacts) reloads.push(loadAdminContactProfiles());
		if (pendingAdminReloads.contactMessages) reloads.push(loadAdminContactMessages());
		if (pendingAdminReloads.conversations) reloads.push(loadAdminConversations());
		pendingAdminReloads.teams = false;
		pendingAdminReloads.sports = false;
		pendingAdminReloads.participants = false;
		pendingAdminReloads.overview = false;
		pendingAdminReloads.feedback = false;
		pendingAdminReloads.announcements = false;
		pendingAdminReloads.accounts = false;
		pendingAdminReloads.contacts = false;
		pendingAdminReloads.contactMessages = false;
		pendingAdminReloads.conversations = false;
		await Promise.all(reloads);
	}, delay);
}

export function scheduleAdminFallbackSync() {
	scheduleAdminRealtimeReload({
		teams: true,
		sports: true,
		participants: true,
		overview: true,
		feedback: true,
		announcements: true,
		accounts: true,
		contacts: true,
		conversations: true,
		contactMessages: Boolean(state.activeAdminContactConversationId)
	}, 0);
}

export function scheduleAdminMessagingReload({ contactMessages = false, conversations = true } = {}, delay = 100) {
	window.clearTimeout(adminRealtimeMessagingTimer);
	adminRealtimeMessagingTimer = window.setTimeout(async () => {
		if (adminMessagingSyncInProgress) {
			scheduleAdminMessagingReload({ contactMessages, conversations }, delay);
			return;
		}
		adminMessagingSyncInProgress = true;
		try {
			const reloads = [];
			if (conversations) reloads.push(loadAdminConversations());
			if (contactMessages && state.activeAdminContactConversationId) reloads.push(loadAdminContactMessages());
			await Promise.all(reloads);
		} finally {
			adminMessagingSyncInProgress = false;
		}
	}, delay);
}
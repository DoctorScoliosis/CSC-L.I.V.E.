/*
 * Committee dashboard page orchestrator (CommitteeDashboard.html).
 *
 * This is the entry point loaded by the HTML. It does five things:
 *   1. Runs the synchronous auth guard, then populates every DOM element
 *      the feature modules need into the shared `dom` object
 *      (committee-context.js).
 *   2. Owns the tab switcher, sidebar, account identity badge, and logout
 *      (via the shared ui/* and auth/session.js modules).
 *   3. Wires all event listeners.
 *   4. Defines the idle-aware reload scheduling used by the realtime
 *      handlers and fallback polls.
 *   5. Runs the init sequence, the refresh intervals, and the Supabase
 *      realtime subscriptions.
 *
 * All actual logic lives in the feature modules:
 *   features/committee-matches.js       — match management
 *   features/committee-chat.js          — contacts + messaging + bell
 *   features/committee-leaderboard.js   — leaderboard + team history
 *   features/committee-overview.js      — overview counts + announcements
 *   features/committee-attendance.js    — participant + attendance checks
 *   features/committee-basketball-*.js  — score sheet render + actions
 */

import {
	state,
	dom,
	supabase,
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	ANNOUNCEMENTS_TABLE,
	CONVERSATIONS_TABLE,
	MESSAGES_TABLE,
	COMMITTEE_REFRESH_IDLE_DELAY
} from "./committee-context.js";
import { checkDashboardAuth, loadDashboardUser, signOutAndRedirect, getUserInitial, getUserDisplayName, getDashboardRoleLabel } from "../auth/session.js";
import { initBackgroundRotator } from "../features/background-rotator.js";
import { createTabSwitcher } from "../ui/tabs.js";
import { openSidebar, closeSidebar, toggleSidebar, initSidebarAutoClose } from "../ui/sidebar.js";
import {
	placeMatchControlsForTab,
	revealPlacedMatchControls,
	loadSportsForMatches,
	loadRegisteredTeams,
	loadSavedMatches,
	renderMatches,
	setActiveStatusTab,
	setActiveMatchScopeFilter,
	updateCountdownDisplays,
	openMatchModalFunction,
	closeMatchModalFunction,
	saveMatch,
	openResultModalFunction,
	closeResultModalFunction,
	saveMatchResult,
	closeBasketballPointModalFunction,
	addBasketballPointChoiceListeners,
	openSportFilterModalFunction,
	closeSportFilterModalFunction,
	handleSportFilterChange,
	clearSportFilterSelection,
	handleDoneDateFilterChange,
	clearDoneDateFilter,
	openDoneDatePicker
} from "../features/committee-matches.js";
import {
	loadContactPersonnel,
	loadCommitteeConversations,
	loadContactMessages,
	renderContactsList,
	setContactsVisible,
	resetActiveContactConversation,
	sendContactMessageSubmit,
	deleteActiveConversation,
	setConversationMenuVisible,
	setNotificationPanelVisible,
	updateMessageNotification,
	handleCameraInputChange,
	clearCameraPhoto,
	toggleChatOpen
} from "../features/committee-chat.js";
import {
	loadLeaderboard,
	refreshCommitteeLeaderboard,
	closeHistoryModalFunction
} from "../features/committee-leaderboard.js";
import {
	loadOverviewCounts,
	loadCommitteeAnnouncements,
	notifyCommitteeAnnouncementChange
} from "../features/committee-overview.js";
import {
	checkParticipantRegistration,
	clearParticipantCheck,
	verifyParticipantAttendance,
	clearVerifyResult
} from "../features/committee-attendance.js";

// --- 1. Auth guard + DOM population ------------------------------------------
checkDashboardAuth(["committee", "admin"]);

dom.teamsCount = document.getElementById("teamsCount");
dom.participantsCount = document.getElementById("participantsCount");
dom.committeeTotalSports = document.getElementById("committeeTotalSports");
dom.committeeTotalMatches = document.getElementById("committeeTotalMatches");
dom.upcomingMatchesCount = document.getElementById("upcomingMatchesCount");
dom.committeeActiveGames = document.getElementById("committeeActiveGames");
dom.completedMatchesCount = document.getElementById("completedMatchesCount");
dom.committeeTotalDays = document.getElementById("committeeTotalDays");
dom.committeeAnnouncementsList = document.getElementById("committeeAnnouncementsList");
dom.leaderboardBody = document.getElementById("leaderboardBody");
dom.historyModal = document.getElementById("historyModal");
dom.closeHistoryModal = document.getElementById("closeHistoryModal");
dom.historyTitle = document.getElementById("historyTitle");
dom.historyContent = document.getElementById("historyContent");
dom.verifyAttendanceForm = document.getElementById("verifyAttendanceForm");
dom.verifyStudentId = document.getElementById("verifyStudentId");
dom.verifyAttendanceResult = document.getElementById("verifyAttendanceResult");
dom.clearVerificationResult = document.getElementById("clearVerificationResult");
dom.participantCheckForm = document.getElementById("participantCheckForm");
dom.participantCheckStudentId = document.getElementById("participantCheckStudentId");
dom.participantCheckResult = document.getElementById("participantCheckResult");
dom.clearParticipantCheckResult = document.getElementById("clearParticipantCheckResult");
dom.openMatchModal = document.getElementById("openMatchModal");
dom.closeMatchModal = document.getElementById("closeMatchModal");
dom.cancelMatchModal = document.getElementById("cancelMatchModal");
dom.matchModal = document.getElementById("matchModal");
dom.matchModalTitle = document.getElementById("matchModalTitle");
dom.matchForm = document.getElementById("matchForm");
dom.editingMatchId = document.getElementById("editingMatchId");
dom.matchSubmitButton = document.getElementById("matchSubmitButton");
dom.matchSport = document.getElementById("matchSport");
dom.matchStage = document.getElementById("matchStage");
dom.battleForThirdOption = document.getElementById("battleForThirdOption");
dom.teamOne = document.getElementById("teamOne");
dom.teamTwo = document.getElementById("teamTwo");
dom.matchTime = document.getElementById("matchTime");
dom.matchLocation = document.getElementById("matchLocation");
dom.matchTimerMinutes = document.getElementById("matchTimerMinutes");
dom.matchTimerSeconds = document.getElementById("matchTimerSeconds");
dom.openSportFilterModal = document.getElementById("openSportFilterModal");
dom.sportFilterModal = document.getElementById("sportFilterModal");
dom.closeSportFilterModal = document.getElementById("closeSportFilterModal");
dom.sportFilterSelect = document.getElementById("sportFilterSelect");
dom.clearSportFilter = document.getElementById("clearSportFilter");
dom.matchViewFilterCard = document.getElementById("matchViewFilterCard");
dom.matchHeaderControls = document.getElementById("matchHeaderControls");
dom.matchControlsHome = document.getElementById("matchControlsHome");
dom.matchPrimaryControls = document.getElementById("matchPrimaryControls");
dom.nextMatchesGrid = document.getElementById("nextMatchesGrid");
dom.ongoingMatchesGrid = document.getElementById("ongoingMatchesGrid");
dom.doneMatchesGrid = document.getElementById("doneMatchesGrid");
dom.doneMatchesDateFilter = document.getElementById("doneMatchesDateFilter");
dom.clearDoneMatchesDateFilter = document.getElementById("clearDoneMatchesDateFilter");
dom.openDoneMatchesDatePicker = document.getElementById("openDoneMatchesDatePicker");
dom.contactsList = document.getElementById("contactsList");
dom.contactsSection = document.getElementById("contactsSection");
dom.committeeConversationList = document.getElementById("committeeConversationList");
dom.committeeChatShell = document.getElementById("committeeChatShell");
dom.committeeChatBack = document.getElementById("committeeChatBack");
dom.contactSearchInput = document.getElementById("contactSearchInput");
dom.contactsSportSummary = document.getElementById("contactsSportSummary");
dom.contactsSportSelect = document.getElementById("contactsSportSelect");
dom.activeChatTitle = document.getElementById("activeChatTitle");
dom.activeChatSubtitle = document.getElementById("activeChatSubtitle");
dom.activeChatAvatar = document.getElementById("activeChatAvatar");
dom.activeChatCall = document.getElementById("activeChatCall");
dom.activeChatStatus = document.getElementById("activeChatStatus");
dom.notificationContainer = document.getElementById("notificationContainer");
dom.messageNotificationBell = document.getElementById("messageNotificationBell");
dom.messageNotificationBadge = document.getElementById("messageNotificationBadge");
dom.notificationPanel = document.getElementById("notificationPanel");
dom.notificationList = document.getElementById("notificationList");
dom.conversationMenuContainer = document.getElementById("conversationMenuContainer");
dom.conversationMenuButton = document.getElementById("conversationMenuButton");
dom.conversationMenu = document.getElementById("conversationMenu");
dom.deleteConversation = document.getElementById("deleteConversation");
dom.contactMessagesList = document.getElementById("contactMessagesList");
dom.contactMessageForm = document.getElementById("contactMessageForm");
dom.contactMessageInput = document.getElementById("contactMessageInput");
dom.sendContactMessage = document.getElementById("sendContactMessage");
dom.openCamera = document.getElementById("openCamera");
dom.cameraInput = document.getElementById("cameraInput");
dom.cameraPreview = document.getElementById("cameraPreview");
dom.cameraPreviewImage = document.getElementById("cameraPreviewImage");
dom.removeCameraPhoto = document.getElementById("removeCameraPhoto");
dom.resultModal = document.getElementById("resultModal");
dom.closeResultModal = document.getElementById("closeResultModal");
dom.cancelResultModal = document.getElementById("cancelResultModal");
dom.resultForm = document.getElementById("resultForm");
dom.resultMatchId = document.getElementById("resultMatchId");
dom.resultMatchSummary = document.getElementById("resultMatchSummary");
dom.winnerTeamSelect = document.getElementById("winnerTeamSelect");
dom.bestPlayerInput = document.getElementById("bestPlayerInput");
dom.winnerActualPointsInput = document.getElementById("winnerActualPointsInput");
dom.loserActualPointsInput = document.getElementById("loserActualPointsInput");
dom.teamOneAdjustmentTitle = document.getElementById("teamOneAdjustmentTitle");
dom.teamTwoAdjustmentTitle = document.getElementById("teamTwoAdjustmentTitle");
dom.teamOneMeritPointsInput = document.getElementById("teamOneMeritPointsInput");
dom.teamOneMeritRemarksInput = document.getElementById("teamOneMeritRemarksInput");
dom.teamOneDemeritPointsInput = document.getElementById("teamOneDemeritPointsInput");
dom.teamOneDemeritRemarksInput = document.getElementById("teamOneDemeritRemarksInput");
dom.teamTwoMeritPointsInput = document.getElementById("teamTwoMeritPointsInput");
dom.teamTwoMeritRemarksInput = document.getElementById("teamTwoMeritRemarksInput");
dom.teamTwoDemeritPointsInput = document.getElementById("teamTwoDemeritPointsInput");
dom.teamTwoDemeritRemarksInput = document.getElementById("teamTwoDemeritRemarksInput");
dom.basketballPointModal = document.getElementById("basketballPointModal");
dom.basketballPointModalTitle = document.getElementById("basketballPointModalTitle");
dom.basketballPointPlayerLabel = document.getElementById("basketballPointPlayerLabel");
dom.closeBasketballPointModal = document.getElementById("closeBasketballPointModal");
dom.accountInitialBadge = document.getElementById("accountInitialBadge");
dom.accountDisplayName = document.getElementById("accountDisplayName");
dom.accountDisplayRole = document.getElementById("accountDisplayRole");

// --- 2. Tabs, sidebar, identity, logout --------------------------------------
const tabSwitcher = createTabSwitcher({
	titles: {
		overview: "Committee Dashboard",
		leaderboard: "Leaderboard",
		verifyAttendance: "Participant Checker",
		matches: "Match Management",
		contacts: "Committee Contacts",
		about: "About L.I.V.E."
	},
	descriptions: {
		overview: "Monitor sports activities and team performance.",
		leaderboard: "View real-time team rankings and scores.",
		verifyAttendance: "Check participant registration and attendance credibility.",
		matches: "Schedule matches and declare winners before marking games as done.",
		contacts: "Find sport committee personnel and message them in realtime.",
		about: "Learn about the League Information & Viewing Engine."
	},
	storageKey: "committeeDashboardActiveTab",
	sessionStartedKey: "committeeDashboardSessionStarted",
	defaultTab: "overview",
	onSwitch: selectedTabName => {
		document.querySelector(".dashboard-header")?.classList.toggle("match-management-active", selectedTabName === "matches");
		placeMatchControlsForTab(selectedTabName);
	}
});
// Reachable from the inline onclick handlers in the HTML.
window.switchTab = tabSwitcher.switchTab;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleSidebar = toggleSidebar;
window.logout = () => signOutAndRedirect(["committeeDashboardSessionStarted"]);
initSidebarAutoClose();

function renderAccountIdentity(userData = null) {
	const resolvedUser = userData || state.currentUser;
	if (!dom.accountInitialBadge || !dom.accountDisplayName || !dom.accountDisplayRole) {
		return;
	}
	if (!resolvedUser) {
		dom.accountInitialBadge.textContent = "?";
		dom.accountDisplayName.textContent = "Account";
		dom.accountDisplayRole.textContent = "Not signed in";
		return;
	}
	dom.accountInitialBadge.textContent = getUserInitial(resolvedUser);
	dom.accountDisplayName.textContent = getUserDisplayName(resolvedUser);
	dom.accountDisplayRole.textContent = getDashboardRoleLabel(resolvedUser);
	dom.accountInitialBadge.title = `${getUserDisplayName(resolvedUser)} • ${getDashboardRoleLabel(resolvedUser)}`;
}

initBackgroundRotator();
tabSwitcher.restoreActiveTab();
renderAccountIdentity();

// --- 4. Idle-aware reload scheduling -----------------------------------------
let committeeLastInteractionAt = 0;
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
document.addEventListener("input", trackCommitteeInteraction, true);
document.addEventListener("change", trackCommitteeInteraction, true);
document.addEventListener("pointerdown", trackCommitteeInteraction, true);
document.addEventListener("keydown", trackCommitteeInteraction, true);
document.addEventListener("submit", clearCommitteeDirtyForm, true);
document.addEventListener("reset", clearCommitteeDirtyForm, true);

let committeeRealtimeReloadTimer = null;
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
function scheduleCommitteeRealtimeReload(tasks, delay = 250, options = {}) {
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
function scheduleCommitteeFallbackSync() {
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
let committeeMessagingSyncInProgress = false;
let committeeRealtimeMessagingTimer = null;
function scheduleCommitteeMessagingReload({ contactMessages = false, conversations = true } = {}, delay = 100) {
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

// --- 3. Event wiring ---------------------------------------------------------
document.querySelectorAll(".match-status-tab").forEach(button => {
	button.addEventListener("click", function () {
		setActiveStatusTab(this.dataset.statusTab);
	});
});
document.querySelectorAll(".match-scope-tab").forEach(button => {
	button.addEventListener("click", function () {
		setActiveMatchScopeFilter(this.dataset.matchScopeTab);
	});
});
dom.openSportFilterModal.addEventListener("click", openSportFilterModalFunction);
dom.closeSportFilterModal.addEventListener("click", closeSportFilterModalFunction);
dom.sportFilterModal.addEventListener("click", function (event) {
	if (event.target === dom.sportFilterModal) {
		closeSportFilterModalFunction();
	}
});
dom.sportFilterSelect.addEventListener("change", handleSportFilterChange);
dom.clearSportFilter.addEventListener("click", clearSportFilterSelection);
dom.openDoneMatchesDatePicker.addEventListener("click", openDoneDatePicker);
dom.doneMatchesDateFilter.addEventListener("change", handleDoneDateFilterChange);
dom.clearDoneMatchesDateFilter.addEventListener("click", clearDoneDateFilter);
dom.openMatchModal.addEventListener("click", openMatchModalFunction);
dom.closeMatchModal.addEventListener("click", closeMatchModalFunction);
dom.cancelMatchModal.addEventListener("click", closeMatchModalFunction);
dom.matchForm.addEventListener("submit", saveMatch);
dom.closeResultModal.addEventListener("click", closeResultModalFunction);
dom.cancelResultModal.addEventListener("click", closeResultModalFunction);
dom.resultModal.addEventListener("click", function (event) {
	if (event.target === dom.resultModal) {
		closeResultModalFunction();
	}
});
dom.resultForm.addEventListener("submit", saveMatchResult);
dom.closeBasketballPointModal.addEventListener("click", closeBasketballPointModalFunction);
dom.basketballPointModal.addEventListener("click", function (event) {
	if (event.target === dom.basketballPointModal) {
		closeBasketballPointModalFunction();
	}
});
addBasketballPointChoiceListeners();
dom.contactsSportSelect.addEventListener("change", function () {
	setContactsVisible(true);
	const nextSportId = this.value || "";
	if (!nextSportId) {
		state.activeContactSportId = "";
		resetActiveContactConversation();
		renderContactsList();
		return;
	}
	if (String(nextSportId) !== String(state.activeContactSportId)) {
		resetActiveContactConversation();
	}
	state.activeContactSportId = nextSportId;
	renderContactsList();
});
dom.contactMessageForm.addEventListener("submit", sendContactMessageSubmit);
dom.openCamera.addEventListener("click", function () {
	dom.cameraInput.click();
});
dom.cameraInput.addEventListener("change", handleCameraInputChange);
dom.removeCameraPhoto.addEventListener("click", function () {
	clearCameraPhoto();
});
dom.contactMessageInput.addEventListener("input", function () {
	// Send-button enablement is handled by committee-chat.js on input.
});
dom.contactSearchInput.addEventListener("input", function () {
	setContactsVisible(true);
	state.activeContactSearchTerm = this.value || "";
	renderContactsList();
});
dom.committeeChatBack.addEventListener("click", toggleChatOpen);
dom.messageNotificationBell.addEventListener("click", function () {
	setNotificationPanelVisible(dom.notificationPanel.classList.contains("hidden"));
});
dom.conversationMenuButton.addEventListener("click", function () {
	setConversationMenuVisible(dom.conversationMenu.classList.contains("hidden"));
});
dom.deleteConversation.addEventListener("click", deleteActiveConversation);
document.addEventListener("click", function (event) {
	if (!dom.conversationMenuContainer.contains(event.target)) {
		setConversationMenuVisible(false);
	}
	if (!dom.notificationContainer.contains(event.target)) {
		setNotificationPanelVisible(false);
	}
});
dom.closeHistoryModal.addEventListener("click", closeHistoryModalFunction);
dom.historyModal.addEventListener("click", function (event) {
	if (event.target === dom.historyModal) {
		closeHistoryModalFunction();
	}
});
dom.participantCheckForm.addEventListener("submit", checkParticipantRegistration);
dom.clearParticipantCheckResult.addEventListener("click", clearParticipantCheck);
dom.verifyAttendanceForm.addEventListener("submit", verifyParticipantAttendance);
dom.clearVerificationResult.addEventListener("click", clearVerifyResult);

// --- 5. Init, intervals, realtime --------------------------------------------
const loadedUser = await loadDashboardUser({
	allowedRoles: ["committee", "admin"],
	roleDefault: "committee"
});
if (!loadedUser) return;
state.currentUser = loadedUser;
renderAccountIdentity(state.currentUser);

setActiveMatchScopeFilter(state.activeMatchScopeFilter);
placeMatchControlsForTab(document.querySelector(".tab-content:not(.hidden)")?.id || "overview");
revealPlacedMatchControls();

await Promise.all([
	loadOverviewCounts(),
	loadLeaderboard(),
	loadCommitteeAnnouncements(),
	loadContactPersonnel(),
	loadCommitteeConversations(),
	loadSportsForMatches(),
	loadRegisteredTeams(),
	loadSavedMatches()
]);

placeMatchControlsForTab(document.querySelector(".tab-content:not(.hidden)")?.id || "overview");
window.addEventListener("resize", function () {
	placeMatchControlsForTab(document.querySelector(".tab-content:not(.hidden)")?.id || "overview");
});

setInterval(() => scheduleCommitteeRealtimeReload({ overview: true }), 10000);
setInterval(loadCommitteeAnnouncements, 2000);
setInterval(refreshCommitteeLeaderboard, 2000);
setInterval(updateCountdownDisplays, 1000);
setInterval(scheduleCommitteeFallbackSync, 15000);
document.addEventListener("visibilitychange", function () {
	if (!document.hidden) {
		scheduleCommitteeFallbackSync();
	}
});
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

supabase
	.channel("committee-dashboard-realtime")
	.on("postgres_changes", { event: "*", schema: "public", table: TEAMS_TABLE }, () => scheduleCommitteeRealtimeReload({ overview: true, leaderboard: true, teams: true, matches: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: PARTICIPANTS_TABLE }, () => scheduleCommitteeRealtimeReload({ overview: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: ATTENDANCE_TABLE }, () => scheduleCommitteeRealtimeReload({ overview: true, leaderboard: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: MATCHES_TABLE }, () => scheduleCommitteeRealtimeReload({ overview: true, matches: true, leaderboard: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: GAME_HISTORY_TABLE }, () => scheduleCommitteeRealtimeReload({ matches: true, leaderboard: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: BASKETBALL_STATS_TABLE }, () => scheduleCommitteeRealtimeReload({ matches: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: SPORTS_TABLE }, () => scheduleCommitteeRealtimeReload({ sports: true, matches: true, leaderboard: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: ANNOUNCEMENTS_TABLE }, notifyCommitteeAnnouncementChange)
	.on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => scheduleCommitteeRealtimeReload({ contacts: true }, 0, { force: true }))
	.on("postgres_changes", { event: "*", schema: "public", table: MESSAGES_TABLE }, payload => {
		const changedConversationId = payload.new?.conversation_id || payload.old?.conversation_id;
		const shouldReloadOpenThread = (state.activeContactConversationIds || [])
			.some(conversationId => String(conversationId) === String(changedConversationId || ""));
		if (payload.eventType === "INSERT" && String(payload.new?.receiver_id || "") === String(state.currentUser?.id || "") && changedConversationId) {
			state.latestUnreadMessages.set(String(changedConversationId), payload.new);
			updateMessageNotification();
		}
		scheduleCommitteeMessagingReload({
			contactMessages: Boolean(shouldReloadOpenThread),
			conversations: true
		}, 100);
	})
	.on("postgres_changes", { event: "*", schema: "public", table: CONVERSATIONS_TABLE }, () => {
		scheduleCommitteeMessagingReload({ conversations: true }, 100);
	})
	.subscribe();
/*
 * Student dashboard page orchestrator (StudentDashboard.html).
 *
 * This is the entry point loaded by the HTML. It does four things:
 *   1. Queries every DOM element the feature modules need and stores the
 *      references in the shared `dom` object (student-context.js).
 *   2. Owns the tab switcher (attached to window for the inline onclick
 *      handlers in the HTML) and the background rotator.
 *   3. Wires all event listeners.
 *   4. Runs the init sequence, the refresh intervals, and the Supabase
 *      realtime subscriptions.
 *
 * All actual logic lives in the feature modules:
 *   features/student-announcements.js  — popup, badge, notifications modal
 *   features/student-basketball.js     — score-sheet preview + sport types
 *   features/student-matches.js        — schedule cards, filters, countdown
 *   features/student-leaderboard.js    — leaderboard load + team history
 *   features/student-feedback.js       — feedback form
 *   features/student-refresh.js        — idle-aware reload scheduling
 *   features/leaderboard.js            — shared leaderboard engine
 */

import { state, dom } from "./student-context.js";
import { initBackgroundRotator } from "../features/background-rotator.js";
import {
	openNotificationsModal,
	closeNotificationsModal,
	closeAnnouncementModal,
	refreshStudentAnnouncements,
	notifyStudentAnnouncementChange
} from "../features/student-announcements.js";
import {
	loadMatches,
	renderMatches,
	loadSportCategoryFilterOptions,
	setActiveScheduleFilter,
	closeMatchDetails,
	updateCountdownDisplays
} from "../features/student-matches.js";
import { loadLeaderboard } from "../features/student-leaderboard.js";
import { submitFeedback } from "../features/student-feedback.js";
import {
	initStudentInteractionTracking,
	loadStats,
	scheduleLiveMatchReload,
	scheduleLiveLeaderboardReload,
	scheduleStudentSupplementalReload
} from "../features/student-refresh.js";
import {
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	ANNOUNCEMENTS_TABLE
} from "./student-context.js";
import { supabase } from "./student-context.js";

// --- 1. Populate the shared DOM context --------------------------------------
dom.studentLeaderboardBody = document.getElementById("studentLeaderboardBody");
dom.studentTotalTeams = document.getElementById("studentTotalTeams");
dom.studentTotalMatches = document.getElementById("studentTotalMatches");
dom.studentTotalParticipants = document.getElementById("studentTotalParticipants");
dom.openAboutModalButton = document.getElementById("openAboutModal");
dom.aboutModal = document.getElementById("aboutModal");
dom.closeAboutModalButton = document.getElementById("closeAboutModal");
dom.studentFeedbackForm = document.getElementById("studentFeedbackForm");
dom.feedbackType = document.getElementById("feedbackType");
dom.feedbackStudentName = document.getElementById("feedbackStudentName");
dom.feedbackStudentId = document.getElementById("feedbackStudentId");
dom.feedbackContact = document.getElementById("feedbackContact");
dom.feedbackMessage = document.getElementById("feedbackMessage");
dom.submitStudentFeedback = document.getElementById("submitStudentFeedback");
dom.studentFeedbackStatus = document.getElementById("studentFeedbackStatus");
dom.studentAnnouncementModal = document.getElementById("studentAnnouncementModal");
dom.closeStudentAnnouncementModal = document.getElementById("closeStudentAnnouncementModal");
dom.studentAnnouncementDate = document.getElementById("studentAnnouncementDate");
dom.studentAnnouncementTitle = document.getElementById("studentAnnouncementTitle");
dom.studentAnnouncementMessage = document.getElementById("studentAnnouncementMessage");
dom.openNotificationsModalButton = document.getElementById("openNotificationsModal");
dom.studentAnnouncementCount = document.getElementById("studentAnnouncementCount");
dom.studentNotificationsModal = document.getElementById("studentNotificationsModal");
dom.closeStudentNotificationsModal = document.getElementById("closeStudentNotificationsModal");
dom.studentNotificationsList = document.getElementById("studentNotificationsList");
dom.studentMatchesGrid = document.getElementById("studentMatchesGrid");
dom.gameCategoryFilter = document.getElementById("gameCategoryFilter");
dom.matchDetailsModal = document.getElementById("matchDetailsModal");
dom.closeMatchDetailsModal = document.getElementById("closeMatchDetailsModal");
dom.matchDetailsTitle = document.getElementById("matchDetailsTitle");
dom.matchDetailsContent = document.getElementById("matchDetailsContent");

// --- 2. Tab switcher + background rotator ------------------------------------
// switchTab is attached to window because the tab buttons in the HTML use
// inline onclick="switchTab('leaderboard', this)" handlers.

const STUDENT_ACTIVE_TAB_KEY = "cscLiveStudentActiveTab";
const VALID_STUDENT_TABS = ["leaderboard", "schedule"];

function switchTab(tabName, buttonElement) {
	const selectedTabName = VALID_STUDENT_TABS.includes(tabName) ? tabName : "leaderboard";
	document.querySelectorAll(".tab-content").forEach(tab => {
		tab.classList.add("hidden");
	});
	document.querySelectorAll(".tab-button").forEach(button => {
		button.className = "tab-button flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-slate-600 hover:bg-slate-50 font-semibold text-sm sm:text-base transition-all duration-200";
	});
	document.getElementById(selectedTabName).classList.remove("hidden");
	localStorage.setItem(STUDENT_ACTIVE_TAB_KEY, selectedTabName);
	const activeButton = buttonElement || document.querySelector(`[onclick*="'${selectedTabName}'"]`);
	if (activeButton) {
		activeButton.className = "tab-button active flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-semibold text-sm sm:text-base transition-all duration-200";
	}
}
window.switchTab = switchTab;

function restoreStudentActiveTab() {
	const savedTab = localStorage.getItem(STUDENT_ACTIVE_TAB_KEY);
	switchTab(VALID_STUDENT_TABS.includes(savedTab) ? savedTab : "leaderboard");
}
restoreStudentActiveTab();

initBackgroundRotator();

// --- About modal (small enough to live here) ---------------------------------
function openAboutModal() {
	dom.aboutModal.classList.remove("hidden");
	dom.aboutModal.classList.add("flex");
}
function closeAboutModal() {
	dom.aboutModal.classList.add("hidden");
	dom.aboutModal.classList.remove("flex");
}

// --- 3. Event wiring ---------------------------------------------------------
initStudentInteractionTracking();

document.querySelectorAll(".schedule-filter").forEach(btn => {
	btn.onclick = function() { setActiveScheduleFilter(this.dataset.scheduleFilter); };
});
setActiveScheduleFilter(state.activeScheduleFilter);

if (dom.gameCategoryFilter) {
	dom.gameCategoryFilter.addEventListener("change", function () {
		state.activeSportCategoryFilter = this.value || "All";
		localStorage.setItem("cscLiveStudentSportCategoryFilter", state.activeSportCategoryFilter);
		renderMatches();
	});
}

dom.closeMatchDetailsModal.onclick = closeMatchDetails;
dom.matchDetailsModal.onclick = (e) => { if (e.target === dom.matchDetailsModal) closeMatchDetails(); };
dom.openAboutModalButton.addEventListener("click", openAboutModal);
dom.closeAboutModalButton.addEventListener("click", closeAboutModal);
dom.aboutModal.addEventListener("click", (e) => { if (e.target === dom.aboutModal) closeAboutModal(); });
dom.openNotificationsModalButton.addEventListener("click", openNotificationsModal);
dom.closeStudentNotificationsModal.addEventListener("click", closeNotificationsModal);
dom.studentNotificationsModal.addEventListener("click", (e) => { if (e.target === dom.studentNotificationsModal) closeNotificationsModal(); });
dom.studentFeedbackForm.addEventListener("submit", submitFeedback);
dom.closeStudentAnnouncementModal.addEventListener("click", closeAnnouncementModal);
dom.studentAnnouncementModal.addEventListener("click", (e) => { if (e.target === dom.studentAnnouncementModal) closeAnnouncementModal(); });

// --- 4. Init, intervals, realtime --------------------------------------------
await Promise.all([
	loadStats(),
	loadLeaderboard({ showLoading: true }),
	loadSportCategoryFilterOptions(),
	loadMatches({ showLoading: true }),
	refreshStudentAnnouncements({ showPopup: true })
]);

setInterval(updateCountdownDisplays, 1000);
setInterval(() => refreshStudentAnnouncements({ showPopup: false }), 2000);
setInterval(() => loadLeaderboard({ showLoading: false }), 2000);
setInterval(() => {
	scheduleLiveMatchReload(0);
	scheduleLiveLeaderboardReload(0);
	scheduleStudentSupplementalReload({ sports: true, announcements: true }, 0);
}, 15000);

document.addEventListener("visibilitychange", function () {
	if (!document.hidden) {
		scheduleLiveMatchReload(0);
		scheduleLiveLeaderboardReload(0);
		scheduleStudentSupplementalReload({ sports: true, announcements: true }, 0);
	}
});

supabase.channel("student-dashboard-realtime")
	.on("postgres_changes", { event: "*", schema: "public", table: TEAMS_TABLE }, () => {
		scheduleLiveLeaderboardReload(0, { force: true });
		scheduleLiveMatchReload(0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: PARTICIPANTS_TABLE }, async () => {
		await loadStats();
	})
	.on("postgres_changes", { event: "*", schema: "public", table: ATTENDANCE_TABLE }, () => {
		scheduleLiveLeaderboardReload(0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: MATCHES_TABLE }, () => {
		scheduleLiveMatchReload(0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: GAME_HISTORY_TABLE }, () => {
		scheduleLiveLeaderboardReload(0, { force: true });
		scheduleLiveMatchReload(0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: BASKETBALL_STATS_TABLE }, () => {
		scheduleLiveMatchReload(0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: SPORTS_TABLE }, async () => {
		scheduleStudentSupplementalReload({ sports: true }, 0);
		scheduleLiveLeaderboardReload(0, { force: true });
		scheduleLiveMatchReload(0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: ANNOUNCEMENTS_TABLE }, notifyStudentAnnouncementChange)
	.subscribe((status) => {
		if (status === "SUBSCRIBED") {
			return;
		} else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
			console.warn("Realtime listener had a connection issue. Fallback auto-refresh is still active.");
		} else if (status === "CLOSED") {
			console.warn("Realtime listener closed. Fallback auto-refresh is still active.");
		}
	});
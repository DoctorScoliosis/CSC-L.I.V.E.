/*
 * Shared context for the Student dashboard page (StudentDashboard.html).
 *
 * Every student feature module imports from here instead of passing
 * arguments around. Two mutable objects are exported:
 *
 *   state — runtime data (matches, leaderboard cache, announcement tracking)
 *   dom   — DOM element references, populated once by the orchestrator
 *           (student.js) before any feature function is called.
 *
 * The Student dashboard is a PUBLIC page (no login). It uses the
 * default-persistence client (getRegistrationClient), NOT the dashboard
 * sessionStorage client. See supabase-client.js.
 */

import { getRegistrationClient } from "../supabase-client.js";
import {
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	STUDENT_FEEDBACK_TABLE,
	ANNOUNCEMENTS_TABLE
} from "../config.js";

export const supabase = getRegistrationClient();

// Re-export the table names so feature modules import them from one place.
export {
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	STUDENT_FEEDBACK_TABLE,
	ANNOUNCEMENTS_TABLE
};

// --- Storage keys + constants ------------------------------------------------
export const STUDENT_SCHEDULE_FILTER_KEY = "cscLiveStudentScheduleFilter";
export const STUDENT_SPORT_CATEGORY_FILTER_KEY = "cscLiveStudentSportCategoryFilter";
export const VALID_STUDENT_SCHEDULE_FILTERS = ["Next", "Ongoing", "Done"];
export const STUDENT_SEEN_ANNOUNCEMENTS_KEY = "studentSeenAnnouncementIds";
export const STUDENT_REFRESH_IDLE_DELAY = 1200;

// --- Mutable runtime state ---------------------------------------------------
export const state = {
	activeScheduleFilter: VALID_STUDENT_SCHEDULE_FILTERS.includes(localStorage.getItem(STUDENT_SCHEDULE_FILTER_KEY))
		? localStorage.getItem(STUDENT_SCHEDULE_FILTER_KEY)
		: "Next",
	activeSportCategoryFilter: localStorage.getItem(STUDENT_SPORT_CATEGORY_FILTER_KEY) || "All",
	studentMatchesData: [],
	basketballStatsByMatch: new Map(),
	registeredSports: [],
	matchReloadTimer: null,
	leaderboardReloadTimer: null,
	isLoadingMatches: false,
	shouldReloadMatchesAgain: false,
	isLoadingLeaderboard: false,
	shouldReloadLeaderboardAgain: false,
	lastLeaderboardRows: [],
	lastLeaderboardHistoryRows: [],
	lastLeaderboardSignature: "",
	lastMatchesSignature: "",
	lastShownAnnouncementKey: null,
	studentAnnouncementsData: [],
	isRefreshingStudentAnnouncements: false,
	shouldRefreshStudentAnnouncementsAgain: false,
	shouldShowQueuedStudentAnnouncementPopup: false,
	studentAnnouncementChanges: new Map(),
	studentLastInteractionAt: 0,
	studentSupplementalReloadTimer: null,
	pendingStudentSupplementalReloads: {
		sports: false,
		announcements: false,
		showAnnouncementPopup: false
	}
};

// --- DOM references ----------------------------------------------------------
// Populated once by student.js at init. Never accessed at module top-level —
// only inside functions that run after the orchestrator has queried the DOM.
export const dom = {};
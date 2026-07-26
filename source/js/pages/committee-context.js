/*
 * Shared context for the Committee dashboard page (CommitteeDashboard.html).
 *
 * Every committee feature module imports from here instead of passing
 * arguments around. Two mutable objects are exported:
 *
 *   state — runtime data (matches, conversations, announcements, reload
 *           scheduling flags, and the signed-in user)
 *   dom   — DOM element references, populated once by the orchestrator
 *           (committee.js) before any feature function is called.
 *
 * The Committee dashboard is an AUTHENTICATED page. It uses the dashboard
 * Supabase client (sessionStorage, "csc-live-auth-session"), NOT the
 * public/registration client. See supabase-client.js.
 */

import { supabase } from "../supabase-client.js";
import {
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	ANNOUNCEMENTS_TABLE,
	ACCOUNT_PROFILES_TABLE,
	CONVERSATIONS_TABLE,
	MESSAGES_TABLE,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME
} from "../config.js";
import { normalizeComparableValue } from "../utils/normalize.js";

export {
	supabase,
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	ANNOUNCEMENTS_TABLE,
	ACCOUNT_PROFILES_TABLE,
	CONVERSATIONS_TABLE,
	MESSAGES_TABLE,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME
};

// --- Storage keys + constants ------------------------------------------------
export const COMMITTEE_MATCH_STATUS_TAB_KEY = "cscLiveCommitteeMatchStatusTab";
export const COMMITTEE_MATCH_SCOPE_KEY = "cscLiveCommitteeMatchScope";
export const VALID_MATCH_STATUS_TABS = ["Next", "Ongoing", "Done"];
export const VALID_MATCH_SCOPES = ["mine", "all"];
export const MATCH_PERMISSION_MESSAGE = "You do not have permission to manage this match.";
export const COMMITTEE_REFRESH_IDLE_DELAY = 1200;

// --- Mutable runtime state ---------------------------------------------------
export const state = {
	// Set by the orchestrator after loadDashboardUser(). Everything else
	// reads the signed-in user through the helpers below.
	currentUser: null,

	// Matches
	activeStatusTab: VALID_MATCH_STATUS_TABS.includes(localStorage.getItem(COMMITTEE_MATCH_STATUS_TAB_KEY))
		? localStorage.getItem(COMMITTEE_MATCH_STATUS_TAB_KEY)
		: "Next",
	activeMatchScopeFilter: VALID_MATCH_SCOPES.includes(localStorage.getItem(COMMITTEE_MATCH_SCOPE_KEY))
		? localStorage.getItem(COMMITTEE_MATCH_SCOPE_KEY)
		: "mine",
	activeSportFilterId: "",
	activeDoneMatchesDate: "",
	registeredSportsData: [],
	matchesData: [],
	basketballStatsByMatch: new Map(),
	pendingBasketballPointTarget: null,
	pendingResultMatch: null,

	// Chat / contacts / messaging
	contactPersonnelData: [],
	committeeAllConversationsData: [],
	committeeConversationsData: [],
	latestUnreadMessages: new Map(),
	committeeConversationListMarkup: "",
	activeContactSportId: "",
	activeContactSearchTerm: "",
	activeContactProfile: null,
	activeContactConversation: null,
	activeContactConversationId: null,
	activeContactConversationIds: [],
	activeContactMessages: [],
	contactMessagesListMarkup: "",
	cameraPreviewUrl: "",
	cameraPhotoFile: null,

	// Overview + announcements
	committeeAnnouncementsData: [],
	hasLoadedCommitteeAnnouncements: false,
	isLoadingCommitteeAnnouncements: false,
	shouldReloadCommitteeAnnouncementsAgain: false,
	unreadCommitteeAnnouncements: new Map(),

	// Leaderboard
	hasRenderedCommitteeLeaderboard: false,
	isRefreshingCommitteeLeaderboard: false,
	shouldRefreshCommitteeLeaderboardAgain: false,
	lastCommitteeLeaderboardSignature: "",

	// Reload scheduling
	committeeLastInteractionAt: 0,
	committeeRealtimeReloadTimer: null,
	pendingCommitteeReloads: {
		overview: false,
		leaderboard: false,
		sports: false,
		teams: false,
		matches: false,
		announcements: false,
		contacts: false,
		contactMessages: false,
		conversations: false
	},
	committeeMessagingSyncInProgress: false,
	committeeRealtimeMessagingTimer: null
};

// --- DOM references ----------------------------------------------------------
// Populated once by committee.js at init. Never accessed at module top-level —
// only inside functions that run after the orchestrator has queried the DOM.
export const dom = {};

// --- Signed-in user helpers --------------------------------------------------
export function isCurrentUserAdmin() {
	return normalizeComparableValue(state.currentUser?.role) === "admin";
}

export function getCurrentUserCreatorKey() {
	return String(state.currentUser?.id || state.currentUser?.email || "").trim();
}

export function getCurrentUserCreatorKeys() {
	return [
		state.currentUser?.id,
		state.currentUser?.email
	]
		.map(value => String(value || "").trim())
		.filter(Boolean);
}

export function getCurrentUserDisplayName() {
	return state.currentUser?.fullName || state.currentUser?.email || state.currentUser?.id || "Unknown User";
}

export function isMatchOwner(match) {
	if (!match || !state.currentUser) {
		return false;
	}
	const creatorValue = normalizeComparableValue(match.created_by);
	const currentUserValues = [
		state.currentUser.id,
		state.currentUser.email
	]
		.map(normalizeComparableValue)
		.filter(Boolean);
	return Boolean(creatorValue && currentUserValues.includes(creatorValue));
}

export function canManageMatch(match) {
	return isCurrentUserAdmin() || isMatchOwner(match);
}
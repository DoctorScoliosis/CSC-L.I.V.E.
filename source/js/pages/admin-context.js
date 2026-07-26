/*
 * Shared context for the Admin dashboard page (AdminDashboard.html).
 *
 * Owns the Supabase client, table constants, all mutable state, the DOM
 * reference map, and the current-admin-user helpers. Every admin feature
 * module imports from here.
 *
 * The admin dashboard is an AUTHENTICATED page. It uses the dashboard
 * Supabase client (sessionStorage, "csc-live-auth-session"). The current
 * user is loaded by the orchestrator via loadDashboardUser from
 * auth/session.js with allowedRoles ["admin"], then stored in
 * state.currentAdminUser.
 */

import { supabase } from "../supabase-client.js";
import {
	TEAMS_TABLE,
	TEAM_NAME_COLUMN,
	PARTICIPANTS_TABLE,
	PARTICIPANT_TEAM_COLUMN,
	PARTICIPANT_DOCUMENTS_BUCKET,
	MATCHES_TABLE,
	SPORTS_TABLE,
	ATTENDANCE_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	STUDENT_FEEDBACK_TABLE,
	ANNOUNCEMENTS_TABLE,
	ACCOUNT_PROFILES_TABLE,
	CONVERSATIONS_TABLE,
	MESSAGES_TABLE,
	MESSAGE_ATTACHMENTS_BUCKET,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME
} from "../config.js";
import { normalizeComparableValue } from "../utils/normalize.js";

export {
	supabase,
	TEAMS_TABLE,
	TEAM_NAME_COLUMN,
	PARTICIPANTS_TABLE,
	PARTICIPANT_TEAM_COLUMN,
	PARTICIPANT_DOCUMENTS_BUCKET,
	MATCHES_TABLE,
	SPORTS_TABLE,
	ATTENDANCE_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	STUDENT_FEEDBACK_TABLE,
	ANNOUNCEMENTS_TABLE,
	ACCOUNT_PROFILES_TABLE,
	CONVERSATIONS_TABLE,
	MESSAGES_TABLE,
	MESSAGE_ATTACHMENTS_BUCKET,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME
};

// --- Mutable runtime state ---------------------------------------------------
export const state = {
	currentAdminUser: null,

	// Teams / sports / participants
	teamsData: [],
	sportsData: [],
	participantsData: [],
	activeParticipantEditRecord: null,
	activeParticipantDetailsId: null,

	// Feedback
	studentFeedbackData: [],
	isLoadingStudentFeedback: false,
	shouldReloadStudentFeedbackAgain: false,

	// Announcements
	announcementsData: [],

	// Account approvals
	accountApprovalsData: [],
	isLoadingAccountApprovals: false,
	shouldReloadAccountApprovalsAgain: false,
	editingAccountSportId: "",

	// Overview
	hasLoadedAdminOverview: false,
	adminPendingDeleteRequests: [],

	// Communications
	adminContactProfilesData: [],
	adminAllConversationsData: [],
	adminConversationsData: [],
	adminLatestUnreadMessages: new Map(),
	adminConversationListMarkup: "",
	activeAdminContactGroup: "",
	activeAdminContactSearchTerm: "",
	activeAdminContactProfile: null,
	activeAdminContactConversation: null,
	activeAdminContactConversationId: null,
	activeAdminContactConversationIds: [],
	activeAdminContactMessages: [],
	adminMessagesListMarkup: "",
	adminCameraPreviewUrl: "",
	adminCameraPhotoFile: null
};

// --- DOM references ----------------------------------------------------------
// Populated once by admin.js at init. Never accessed at module top-level —
// only inside functions that run after the orchestrator has queried the DOM.
export const dom = {};

// --- Current admin user helpers ----------------------------------------------
export function getStoredAdminUser() {
	try {
		return JSON.parse(sessionStorage.getItem("user") || "null");
	} catch (error) {
		return null;
	}
}

export function normalizeAdminUser(userData) {
	if (!userData) {
		return null;
	}
	return {
		id: userData.id || userData.user_id || "",
		email: userData.email || "",
		fullName: userData.fullName || userData.full_name || userData.name || "",
		role: normalizeComparableValue(userData.role || "admin"),
		approvalStatus: normalizeComparableValue(userData.approvalStatus || userData.approval_status || "approved"),
		authProvider: userData.authProvider || "supabase"
	};
}

export function isCurrentUserAdmin() {
	return normalizeComparableValue(state.currentAdminUser?.role) === "admin";
}

export function getCurrentAdminUserId() {
	return state.currentAdminUser?.id || "";
}

export function getCurrentAdminDisplayName() {
	return state.currentAdminUser?.fullName || state.currentAdminUser?.email || state.currentAdminUser?.id || "Admin";
}

export function renderAdminSidebarIdentity(userData = null) {
	const badge = dom.adminAccountInitialBadge;
	const displayName = dom.adminAccountDisplayName;
	const displayRole = dom.adminAccountDisplayRole;
	if (!badge || !displayName || !displayRole) {
		return;
	}
	const resolvedUser = userData || normalizeAdminUser(getStoredAdminUser());
	if (!resolvedUser) {
		badge.textContent = "?";
		displayName.textContent = "Account";
		displayRole.textContent = "Not signed in";
		return;
	}
	const name = resolvedUser.fullName || resolvedUser.email || "Current Account";
	const role = normalizeComparableValue(resolvedUser.role) === "committee"
		? "Committee Account"
		: "Admin Account";
	badge.textContent = String(name).trim().charAt(0).toUpperCase() || "?";
	badge.title = `${name} - ${role}`;
	displayName.textContent = name;
	displayRole.textContent = role;
}
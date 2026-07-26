/*
 * Admin dashboard page orchestrator (AdminDashboard.html).
 *
 * This is the entry point loaded by the HTML. It does five things:
 *   1. Runs the synchronous auth guard, then populates every DOM element
 *      the feature modules need into the shared `dom` object
 *      (admin-context.js).
 *   2. Owns the tab switcher, sidebar, account identity badge, and logout
 *      (via the shared ui/* and auth/session.js modules).
 *   3. Wires all event listeners for every tab.
 *   4. Runs the init sequence and the periodic refresh intervals.
 *   5. Subscribes to Supabase realtime, delegating reloads to
 *      admin-refresh.js.
 *
 * All actual logic lives in the feature modules:
 *   features/admin-overview.js     — overview counts + delete requests
 *   features/admin-teams.js        — team CRUD
 *   features/admin-sports.js       — sport CRUD
 *   features/admin-participants.js — participant CRUD + review
 *   features/admin-participant-form.js — add/edit participant modal
 *   features/admin-attendance.js   — attendance checker
 *   features/admin-announcements.js — announcements CRUD
 *   features/admin-feedback.js     — student feedback review
 *   features/admin-accounts.js     — account approvals
 *   features/admin-chat-*.js       — contacts + messaging + notifications
 *   features/admin-prints.js       — printable reports
 *   features/admin-refresh.js      — idle-aware reload scheduling
 */

import { state, dom, supabase, renderAdminSidebarIdentity } from "./admin-context.js";
import { checkDashboardAuth, loadDashboardUser, signOutAndRedirect } from "../auth/session.js";
import { initBackgroundRotator } from "../features/background-rotator.js";
import { createTabSwitcher } from "../ui/tabs.js";
import { openSidebar, closeSidebar, toggleSidebar, initSidebarAutoClose } from "../ui/sidebar.js";
import { loadAdminOverviewCounts } from "../features/admin-overview.js";
import { openAddTeamModal, closeTeamModalFunction, saveTeam, loadTeams } from "../features/admin-teams.js";
import { openAddSportModal, closeSportModalFunction, saveSport, loadSports } from "../features/admin-sports.js";
import {
	loadParticipants,
	renderParticipants,
	closeParticipantDetailsModalFunction,
	closeParticipantImageViewerFunction,
	updateParticipantReviewStatus,
	printFilteredParticipants
} from "../features/admin-participants.js";
import {
	openAddParticipantModal,
	closeParticipantModalFunction,
	saveParticipant,
	updateParticipantImportEditVisibility
} from "../features/admin-participant-form.js";
import { checkAttendance } from "../features/admin-attendance.js";
import {
	loadAnnouncements,
	refreshAdminAnnouncementsRealtime,
	saveAnnouncement,
	openAnnouncementEditModal,
	closeAnnouncementEditModalFunction,
	saveAnnouncementEdit,
	toggleAnnouncement,
	deleteAnnouncement
} from "../features/admin-announcements.js";
import {
	loadStudentFeedback,
	closeStudentFeedbackMessageModalFunction
} from "../features/admin-feedback.js";
import {
	loadAccountApprovals,
	closeAccountSportEditModalFunction,
	updateAccountAssignedGame
} from "../features/admin-accounts.js";
import {
	loadAdminContactProfiles,
	loadAdminConversations,
	setContactsVisible,
	renderAdminContactsList,
	resetActiveAdminContactConversation
} from "../features/admin-chat-contacts.js";
import {
	loadAdminContactMessages,
	sendAdminContactMessageSubmit,
	deleteActiveAdminConversation,
	setChatEnabled,
	setConversationMenuVisible,
	clearAdminCameraPhoto
} from "../features/admin-chat-thread.js";
import {
	updateAdminMessageNotification,
	setNotificationPanelVisible,
	setNotificationConversationOpener,
	openAdminConversationRecord
} from "../features/admin-chat-notifications.js";
import {
	renderPrintTeamOptions,
	renderPrintCommitteeOptions,
	printBestPlayers,
	printCollegeHistory,
	printCollegePoints,
	printAttendanceByDate,
	printCommitteeMatches
} from "../features/admin-prints.js";
import {
	initAdminInteractionTracking,
	scheduleAdminRealtimeReload,
	scheduleAdminFallbackSync,
	scheduleAdminMessagingReload
} from "../features/admin-refresh.js";
import {
	setActiveStatusTab,
	setActiveMatchScopeFilter,
	openMatchModalFunction,
	closeMatchModalFunction,
	saveMatch,
	openResultModalFunction,
	closeResultModalFunction,
	saveMatchResult,
	closeBasketballPointModalFunction,
	addBasketballStatValue,
	openSportFilterModalFunction,
	closeSportFilterModalFunction,
	openEditMatchModalFunction,
	deleteMatchFlow,
	loadSavedMatches,
	renderMatches,
	updateMatchStageOptions,
	placeMatchControlsForTab,
	revealPlacedMatchControls,
	loadSportsForMatches,
	loadRegisteredTeams
} from "../features/admin-matches.js";

// --- 1. Auth guard + DOM population ------------------------------------------
checkDashboardAuth(["admin"]);

dom.adminTotalTeams = document.getElementById("adminTotalTeams");
dom.adminTotalSports = document.getElementById("adminTotalSports");
dom.adminTotalParticipants = document.getElementById("adminTotalParticipants");
dom.adminTotalMatches = document.getElementById("adminTotalMatches");
dom.adminUpcomingMatches = document.getElementById("adminUpcomingMatches");
dom.adminActiveGames = document.getElementById("adminActiveGames");
dom.adminCompletedMatches = document.getElementById("adminCompletedMatches");
dom.adminTotalDays = document.getElementById("adminTotalDays");
dom.adminApprovedParticipants = document.getElementById("adminApprovedParticipants");
dom.adminPendingParticipants = document.getElementById("adminPendingParticipants");
dom.adminRejectedParticipants = document.getElementById("adminRejectedParticipants");
dom.adminTodayAttendance = document.getElementById("adminTodayAttendance");
dom.adminOverviewLastUpdated = document.getElementById("adminOverviewLastUpdated");
dom.overviewMatchStatusBody = document.getElementById("overviewMatchStatusBody");
dom.overviewAttendanceBody = document.getElementById("overviewAttendanceBody");
dom.overviewRecentMatchesBody = document.getElementById("overviewRecentMatchesBody");
dom.overviewTeamSummaryBody = document.getElementById("overviewTeamSummaryBody");
dom.overviewSportsSummaryBody = document.getElementById("overviewSportsSummaryBody");
dom.openTeamModal = document.getElementById("openTeamModal");
dom.closeTeamModal = document.getElementById("closeTeamModal");
dom.cancelTeamModal = document.getElementById("cancelTeamModal");
dom.teamModal = document.getElementById("teamModal");
dom.teamModalTitle = document.getElementById("teamModalTitle");
dom.teamForm = document.getElementById("teamForm");
dom.teamId = document.getElementById("teamId");
dom.teamNameInput = document.getElementById("teamNameInput");
dom.teamsTableBody = document.getElementById("teamsTableBody");
dom.openSportModal = document.getElementById("openSportModal");
dom.closeSportModal = document.getElementById("closeSportModal");
dom.cancelSportModal = document.getElementById("cancelSportModal");
dom.sportModal = document.getElementById("sportModal");
dom.sportModalTitle = document.getElementById("sportModalTitle");
dom.sportForm = document.getElementById("sportForm");
dom.sportId = document.getElementById("sportId");
dom.sportNameInput = document.getElementById("sportNameInput");
dom.sportGameTypeInput = document.getElementById("sportGameTypeInput");
dom.sportPlayerLimitInput = document.getElementById("sportPlayerLimitInput");
dom.sportsTableBody = document.getElementById("sportsTableBody");
dom.openParticipantModalButton = document.getElementById("openParticipantModal");
dom.closeParticipantModalButton = document.getElementById("closeParticipantModal");
dom.cancelParticipantModal = document.getElementById("cancelParticipantModal");
dom.participantModal = document.getElementById("participantModal");
dom.participantModalTitle = document.getElementById("participantModalTitle");
dom.participantForm = document.getElementById("participantForm");
dom.participantId = document.getElementById("participantId");
dom.participantName = document.getElementById("participantName");
dom.participantStudentId = document.getElementById("participantStudentId");
dom.participantCourse = document.getElementById("participantCourse");
dom.participantAge = document.getElementById("participantAge");
dom.participantHomeCollege = document.getElementById("participantHomeCollege");
dom.participantTeam = document.getElementById("participantTeam");
dom.participantIsImport = document.getElementById("participantIsImport");
dom.participantImportCollegeGroup = document.getElementById("participantImportCollegeGroup");
dom.participantImportCollege = document.getElementById("participantImportCollege");
dom.participantGameScope = document.getElementById("participantGameScope");
dom.participantMajorSportName = document.getElementById("participantMajorSportName");
dom.participantMinorSportName = document.getElementById("participantMinorSportName");
dom.participantCreatedAt = document.getElementById("participantCreatedAt");
dom.participantStatus = document.getElementById("participantStatus");
dom.participantReviewedByName = document.getElementById("participantReviewedByName");
dom.participantReviewedAt = document.getElementById("participantReviewedAt");
dom.participantRejectionReasonEdit = document.getElementById("participantRejectionReasonEdit");
dom.participantsTableBody = document.getElementById("participantsTableBody");
dom.participantTeamFilter = document.getElementById("participantTeamFilter");
dom.participantSportFilter = document.getElementById("participantSportFilter");
dom.participantDetailsModal = document.getElementById("participantDetailsModal");
dom.participantDetailsTitle = document.getElementById("participantDetailsTitle");
dom.participantDetailsContent = document.getElementById("participantDetailsContent");
dom.closeParticipantDetailsModal = document.getElementById("closeParticipantDetailsModal");
dom.participantRejectionReason = document.getElementById("participantRejectionReason");
dom.participantReviewStatus = document.getElementById("participantReviewStatus");
dom.participantImageViewerModal = document.getElementById("participantImageViewerModal");
dom.participantImageViewerImage = document.getElementById("participantImageViewerImage");
dom.closeParticipantImageViewer = document.getElementById("closeParticipantImageViewer");
dom.printParticipantsButton = document.getElementById("printParticipantsButton");
dom.attendanceForm = document.getElementById("attendanceForm");
dom.attendanceStudentId = document.getElementById("attendanceStudentId");
dom.attendanceResult = document.getElementById("attendanceResult");
dom.attendanceEmptyState = document.getElementById("attendanceEmptyState");
dom.studentFeedbackTableBody = document.getElementById("studentFeedbackTableBody");
dom.studentFeedbackMessageModal = document.getElementById("studentFeedbackMessageModal");
dom.studentFeedbackMessageModalText = document.getElementById("studentFeedbackMessageModalText");
dom.closeStudentFeedbackMessageModal = document.getElementById("closeStudentFeedbackMessageModal");
dom.announcementForm = document.getElementById("announcementForm");
dom.announcementTitle = document.getElementById("announcementTitle");
dom.announcementMessage = document.getElementById("announcementMessage");
dom.announcementAudience = document.getElementById("announcementAudience");
dom.announcementActive = document.getElementById("announcementActive");
dom.announcementStatus = document.getElementById("announcementStatus");
dom.saveAnnouncementButton = document.getElementById("saveAnnouncementButton");
dom.adminAnnouncementsList = document.getElementById("adminAnnouncementsList");
dom.announcementEditModal = document.getElementById("announcementEditModal");
dom.announcementEditForm = document.getElementById("announcementEditForm");
dom.announcementEditId = document.getElementById("announcementEditId");
dom.announcementEditTitle = document.getElementById("announcementEditTitle");
dom.announcementEditMessage = document.getElementById("announcementEditMessage");
dom.announcementEditAudience = document.getElementById("announcementEditAudience");
dom.announcementEditActive = document.getElementById("announcementEditActive");
dom.closeAnnouncementEditModal = document.getElementById("closeAnnouncementEditModal");
dom.cancelAnnouncementEditModal = document.getElementById("cancelAnnouncementEditModal");
dom.saveAnnouncementEditButton = document.getElementById("saveAnnouncementEditButton");
dom.accountApprovalsTableBody = document.getElementById("accountApprovalsTableBody");
dom.accountSportEditModal = document.getElementById("accountSportEditModal");
dom.closeAccountSportEditModal = document.getElementById("closeAccountSportEditModal");
dom.cancelAccountSportEditModal = document.getElementById("cancelAccountSportEditModal");
dom.accountSportEditAccountName = document.getElementById("accountSportEditAccountName");
dom.accountSportEditSelect = document.getElementById("accountSportEditSelect");
dom.saveAccountSportEdit = document.getElementById("saveAccountSportEdit");
dom.printBestPlayersDate = document.getElementById("printBestPlayersDate");
dom.printBestPlayersButton = document.getElementById("printBestPlayersButton");
dom.printCollegeHistoryTeam = document.getElementById("printCollegeHistoryTeam");
dom.printCollegeHistoryButton = document.getElementById("printCollegeHistoryButton");
dom.printCollegePointsTeam = document.getElementById("printCollegePointsTeam");
dom.printCollegePointsButton = document.getElementById("printCollegePointsButton");
dom.printAttendanceDate = document.getElementById("printAttendanceDate");
dom.printAttendanceByDateButton = document.getElementById("printAttendanceByDateButton");
dom.printCommitteeAccount = document.getElementById("printCommitteeAccount");
dom.printCommitteeMatchesDate = document.getElementById("printCommitteeMatchesDate");
dom.printCommitteeMatchesButton = document.getElementById("printCommitteeMatchesButton");
dom.adminContactsSummary = document.getElementById("adminContactsSummary");
dom.adminContactGroupSelect = document.getElementById("adminContactGroupSelect");
dom.adminContactSearchInput = document.getElementById("adminContactSearchInput");
dom.adminChatShell = document.getElementById("adminChatShell");
dom.adminChatBack = document.getElementById("adminChatBack");
dom.adminContactsSection = document.getElementById("adminContactsSection");
dom.adminContactsTableBody = document.getElementById("adminContactsTableBody");
dom.adminConversationList = document.getElementById("adminConversationList");
dom.adminActiveChatTitle = document.getElementById("adminActiveChatTitle");
dom.adminActiveChatSubtitle = document.getElementById("adminActiveChatSubtitle");
dom.adminActiveChatAvatar = document.getElementById("adminActiveChatAvatar");
dom.adminActiveChatCall = document.getElementById("adminActiveChatCall");
dom.adminActiveChatStatus = document.getElementById("adminActiveChatStatus");
dom.adminNotificationContainer = document.getElementById("adminNotificationContainer");
dom.adminMessageNotificationBell = document.getElementById("adminMessageNotificationBell");
dom.adminMessageNotificationBadge = document.getElementById("adminMessageNotificationBadge");
dom.adminNotificationPanel = document.getElementById("adminNotificationPanel");
dom.adminNotificationList = document.getElementById("adminNotificationList");
dom.adminConversationMenuContainer = document.getElementById("adminConversationMenuContainer");
dom.adminConversationMenuButton = document.getElementById("adminConversationMenuButton");
dom.adminConversationMenu = document.getElementById("adminConversationMenu");
dom.adminDeleteConversation = document.getElementById("adminDeleteConversation");
dom.adminContactMessagesList = document.getElementById("adminContactMessagesList");
dom.adminContactMessageForm = document.getElementById("adminContactMessageForm");
dom.adminContactMessageInput = document.getElementById("adminContactMessageInput");
dom.adminSendContactMessage = document.getElementById("adminSendContactMessage");
dom.adminOpenCamera = document.getElementById("adminOpenCamera");
dom.adminCameraInput = document.getElementById("adminCameraInput");
dom.adminCameraPreview = document.getElementById("adminCameraPreview");
dom.adminCameraPreviewImage = document.getElementById("adminCameraPreviewImage");
dom.adminRemoveCameraPhoto = document.getElementById("adminRemoveCameraPhoto");
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
dom.historyModal = document.getElementById("historyModal");
dom.closeHistoryModal = document.getElementById("closeHistoryModal");
dom.historyTitle = document.getElementById("historyTitle");
dom.historyContent = document.getElementById("historyContent");

// --- 2. Tabs, sidebar, identity, logout --------------------------------------
const tabSwitcher = createTabSwitcher({
	titles: {
		overview: "Dashboard Overview",
		teams: "Manage Teams",
		games: "Manage Games",
		participants: "Participants",
		attendance: "Attendance Checker",
		announcements: "Announcements",
		feedback: "Student Feedback",
		accounts: "Account Approvals",
		communications: "Communications",
		prints: "Prints",
		about: "About L.I.V.E."
	},
	descriptions: {
		overview: "Welcome to the admin dashboard. Manage all aspects of the sports system.",
		teams: "Create, edit, and manage sports teams.",
		games: "Create sports and configure the points assigned per game.",
		participants: "Add, edit, and manage registered participants.",
		attendance: "Check participant attendance using a Student ID.",
		announcements: "Create announcements for committees and students.",
		feedback: "Review student commendations and concerns.",
		accounts: "Review newly registered accounts before they can use the dashboard.",
		communications: "Message committee and admin accounts in realtime.",
		prints: "Generate printable tournament reports and lists.",
		about: "Learn about the League Information & Viewing Engine."
	},
	storageKey: "adminDashboardActiveTab",
	sessionStartedKey: "adminDashboardSessionStarted",
	defaultTab: "overview",
	onSwitch: selectedTabName => {
		placeMatchControlsForTab(selectedTabName);
	}
});
// Reachable from the inline onclick handlers in the HTML.
window.switchTab = tabSwitcher.switchTab;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.toggleSidebar = toggleSidebar;
window.logout = () => signOutAndRedirect(["adminDashboardSessionStarted"]);
initSidebarAutoClose();
initBackgroundRotator();

// Wire the notification bell so clicking a message notification opens the
// matching conversation (breaks the notifications -> thread import cycle).
setNotificationConversationOpener(openAdminConversationRecord);

// --- 3. Event wiring ---------------------------------------------------------
initAdminInteractionTracking();

// Teams
dom.teamForm.addEventListener("submit", saveTeam);
dom.openTeamModal.addEventListener("click", openAddTeamModal);
dom.closeTeamModal.addEventListener("click", closeTeamModalFunction);
dom.cancelTeamModal.addEventListener("click", closeTeamModalFunction);
dom.teamModal.addEventListener("click", function (event) {
	if (event.target === dom.teamModal) closeTeamModalFunction();
});

// Sports
dom.sportForm.addEventListener("submit", saveSport);
dom.openSportModal.addEventListener("click", openAddSportModal);
dom.closeSportModal.addEventListener("click", closeSportModalFunction);
dom.cancelSportModal.addEventListener("click", closeSportModalFunction);
dom.sportModal.addEventListener("click", function (event) {
	if (event.target === dom.sportModal) closeSportModalFunction();
});

// Participants
dom.participantForm.addEventListener("submit", saveParticipant);
dom.openParticipantModalButton.addEventListener("click", openAddParticipantModal);
dom.closeParticipantModalButton.addEventListener("click", closeParticipantModalFunction);
dom.cancelParticipantModal.addEventListener("click", closeParticipantModalFunction);
dom.participantIsImport.addEventListener("change", updateParticipantImportEditVisibility);
dom.participantModal.addEventListener("click", function (event) {
	if (event.target === dom.participantModal) closeParticipantModalFunction();
});
dom.closeParticipantDetailsModal.addEventListener("click", closeParticipantDetailsModalFunction);
dom.participantDetailsModal.addEventListener("click", function (event) {
	if (event.target === dom.participantDetailsModal) closeParticipantDetailsModalFunction();
});
document.querySelectorAll(".participant-review-status-btn").forEach(button => {
	button.addEventListener("click", () => updateParticipantReviewStatus(button.dataset.participantReviewStatus));
});
dom.closeParticipantImageViewer.addEventListener("click", closeParticipantImageViewerFunction);
dom.participantImageViewerModal.addEventListener("click", function (event) {
	if (event.target === dom.participantImageViewerModal) closeParticipantImageViewerFunction();
});
dom.participantTeamFilter.addEventListener("change", renderParticipants);
dom.participantSportFilter.addEventListener("change", renderParticipants);
dom.printParticipantsButton.addEventListener("click", printFilteredParticipants);

// Attendance
dom.attendanceForm.addEventListener("submit", checkAttendance);

// Feedback
dom.closeStudentFeedbackMessageModal.addEventListener("click", closeStudentFeedbackMessageModalFunction);
dom.studentFeedbackMessageModal.addEventListener("click", function (event) {
	if (event.target === dom.studentFeedbackMessageModal) closeStudentFeedbackMessageModalFunction();
});

// Announcements
dom.announcementForm.addEventListener("submit", saveAnnouncement);
dom.announcementEditForm.addEventListener("submit", saveAnnouncementEdit);
dom.closeAnnouncementEditModal.addEventListener("click", closeAnnouncementEditModalFunction);
dom.cancelAnnouncementEditModal.addEventListener("click", closeAnnouncementEditModalFunction);
dom.announcementEditModal.addEventListener("click", function (event) {
	if (event.target === dom.announcementEditModal) closeAnnouncementEditModalFunction();
});

// Accounts
dom.closeAccountSportEditModal.addEventListener("click", closeAccountSportEditModalFunction);
dom.cancelAccountSportEditModal.addEventListener("click", closeAccountSportEditModalFunction);
dom.accountSportEditModal.addEventListener("click", function (event) {
	if (event.target === dom.accountSportEditModal) closeAccountSportEditModalFunction();
});
dom.saveAccountSportEdit.addEventListener("click", async function () {
	if (!state.editingAccountSportId) return;
	await updateAccountAssignedGame(state.editingAccountSportId, dom.accountSportEditSelect.value);
});

// Communications
dom.adminContactGroupSelect.addEventListener("change", function () {
	setContactsVisible(true);
	const nextGroup = this.value || "";
	if (!nextGroup) {
		state.activeAdminContactGroup = "";
		resetActiveAdminContactConversation();
		renderAdminContactsList();
		return;
	}
	if (String(nextGroup) !== String(state.activeAdminContactGroup)) {
		resetActiveAdminContactConversation();
	}
	state.activeAdminContactGroup = nextGroup;
	renderAdminContactsList();
});
dom.adminContactMessageForm.addEventListener("submit", sendAdminContactMessageSubmit);
dom.adminOpenCamera.addEventListener("click", function () {
	dom.adminCameraInput.click();
});
dom.adminCameraInput.addEventListener("change", function () {
	const selectedPhoto = this.files?.[0];
	clearAdminCameraPhoto();
	if (!selectedPhoto) return;
	if (!selectedPhoto.type.startsWith("image/")) {
		alert("Please select an image file.");
		return;
	}
	if (selectedPhoto.size > 8 * 1024 * 1024) {
		alert("Please select an image smaller than 8 MB.");
		return;
	}
	state.adminCameraPhotoFile = selectedPhoto;
	state.adminCameraPreviewUrl = URL.createObjectURL(selectedPhoto);
	dom.adminCameraPreviewImage.src = state.adminCameraPreviewUrl;
	dom.adminCameraPreview.classList.remove("hidden");
	dom.adminCameraPreview.classList.add("flex");
	setChatEnabled(Boolean(state.activeAdminContactConversationId));
});
dom.adminRemoveCameraPhoto.addEventListener("click", function () {
	clearAdminCameraPhoto();
	setChatEnabled(Boolean(state.activeAdminContactConversationId));
});
dom.adminContactMessageInput.addEventListener("input", function () {
	setChatEnabled(Boolean(state.activeAdminContactConversationId));
});
dom.adminContactSearchInput.addEventListener("input", function () {
	setContactsVisible(true);
	state.activeAdminContactSearchTerm = this.value || "";
	renderAdminContactsList();
});
dom.adminChatBack.addEventListener("click", function () {
	dom.adminChatShell.classList.remove("chat-open");
});
dom.adminMessageNotificationBell.addEventListener("click", function () {
	setNotificationPanelVisible(dom.adminNotificationPanel.classList.contains("hidden"));
});
dom.adminConversationMenuButton.addEventListener("click", function () {
	setConversationMenuVisible(dom.adminConversationMenu.classList.contains("hidden"));
});
dom.adminDeleteConversation.addEventListener("click", deleteActiveAdminConversation);
document.addEventListener("click", function (event) {
	if (!dom.adminConversationMenuContainer.contains(event.target)) {
		setConversationMenuVisible(false);
	}
	if (!dom.adminNotificationContainer.contains(event.target) && !dom.adminNotificationPanel.contains(event.target)) {
		setNotificationPanelVisible(false);
	}
});

// Matches
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
dom.matchSport.addEventListener("change", updateMatchStageOptions);
dom.closeSportFilterModal.addEventListener("click", closeSportFilterModalFunction);
dom.sportFilterModal.addEventListener("click", function (event) {
	if (event.target === dom.sportFilterModal) closeSportFilterModalFunction();
});
dom.sportFilterSelect.addEventListener("change", function () {
	state.activeSportFilterId = this.value || "";
	closeSportFilterModalFunction();
	renderMatches(state.matchesData);
});
dom.clearSportFilter.addEventListener("click", function () {
	state.activeSportFilterId = "";
	dom.sportFilterSelect.value = "";
	closeSportFilterModalFunction();
	renderMatches(state.matchesData);
});
dom.openDoneMatchesDatePicker.addEventListener("click", function () {
	if (typeof dom.doneMatchesDateFilter.showPicker === "function") {
		dom.doneMatchesDateFilter.showPicker();
	} else {
		dom.doneMatchesDateFilter.focus();
		dom.doneMatchesDateFilter.click();
	}
});
dom.doneMatchesDateFilter.addEventListener("change", function () {
	state.activeDoneMatchesDate = this.value || "";
	renderMatches(state.matchesData);
});
dom.clearDoneMatchesDateFilter.addEventListener("click", function () {
	state.activeDoneMatchesDate = "";
	dom.doneMatchesDateFilter.value = "";
	renderMatches(state.matchesData);
});
dom.openMatchModal.addEventListener("click", openMatchModalFunction);
dom.closeMatchModal.addEventListener("click", closeMatchModalFunction);
dom.cancelMatchModal.addEventListener("click", closeMatchModalFunction);
dom.matchForm.addEventListener("submit", saveMatch);
dom.closeResultModal.addEventListener("click", closeResultModalFunction);
dom.cancelResultModal.addEventListener("click", closeResultModalFunction);
dom.resultModal.addEventListener("click", function (event) {
	if (event.target === dom.resultModal) closeResultModalFunction();
});
dom.resultForm.addEventListener("submit", saveMatchResult);
dom.closeBasketballPointModal.addEventListener("click", closeBasketballPointModalFunction);
dom.basketballPointModal.addEventListener("click", function (event) {
	if (event.target === dom.basketballPointModal) closeBasketballPointModalFunction();
});
document.querySelectorAll(".basketball-point-choice").forEach(button => {
	button.addEventListener("click", async function () {
		if (!state.pendingBasketballPointTarget?.statId && !state.pendingBasketballPointTarget?.lineupStatId && !state.pendingBasketballPointTarget?.idNumber) {
			closeBasketballPointModalFunction();
			return;
		}
		await addBasketballStatValue(
			state.pendingBasketballPointTarget.statId,
			"points",
			Number(this.dataset.basketballPoints) || 0,
			state.pendingBasketballPointTarget
		);
		closeBasketballPointModalFunction();
	});
});

// History modal
dom.closeHistoryModal.addEventListener("click", function () {
	dom.historyModal.classList.add("hidden");
	dom.historyModal.classList.remove("flex");
});
dom.historyModal.addEventListener("click", function (event) {
	if (event.target === dom.historyModal) {
		dom.historyModal.classList.add("hidden");
		dom.historyModal.classList.remove("flex");
	}
});

// Prints
dom.printBestPlayersButton.addEventListener("click", printBestPlayers);
dom.printCollegeHistoryButton.addEventListener("click", printCollegeHistory);
dom.printCollegePointsButton.addEventListener("click", printCollegePoints);
dom.printAttendanceByDateButton.addEventListener("click", printAttendanceByDate);
dom.printCommitteeMatchesButton.addEventListener("click", printCommitteeMatches);

// --- 4. Init + periodic refresh ----------------------------------------------
if (!await loadDashboardUser({ allowedRoles: ["admin"], roleDefault: "admin" })) return;
state.currentAdminUser = state.currentAdminUser || JSON.parse(sessionStorage.getItem("user") || "null");
renderAdminSidebarIdentity(state.currentAdminUser);

dom.printBestPlayersDate.value = new Date().toLocaleDateString("en-CA");
dom.printAttendanceDate.value = new Date().toLocaleDateString("en-CA");
dom.printCommitteeMatchesDate.value = "";

placeMatchControlsForTab(document.querySelector(".tab-content:not(.hidden)")?.id || "overview");
revealPlacedMatchControls();

await Promise.all([
	loadAdminOverviewCounts({ showLoading: true }),
	loadTeams(),
	loadSportsForMatches(),
	loadRegisteredTeams(),
	loadSavedMatches(),
	loadParticipants(),
	loadStudentFeedback(),
	loadAnnouncements(),
	loadAccountApprovals(),
	loadAdminContactProfiles(),
	loadAdminConversations()
]);
renderPrintTeamOptions();
renderPrintCommitteeOptions();
updateAdminMessageNotification();

placeMatchControlsForTab(document.querySelector(".tab-content:not(.hidden)")?.id || "overview");
window.addEventListener("resize", function () {
	placeMatchControlsForTab(document.querySelector(".tab-content:not(.hidden)")?.id || "overview");
});

setInterval(() => scheduleAdminRealtimeReload({ overview: true }), 10000);
setInterval(loadAnnouncements, 2000);
setInterval(() => scheduleAdminRealtimeReload({ feedback: true }), 5000);
setInterval(scheduleAdminFallbackSync, 15000);
document.addEventListener("visibilitychange", function () {
	if (!document.hidden) {
		scheduleAdminFallbackSync();
	}
});
setInterval(async () => {
	scheduleAdminMessagingReload({ conversations: true, contactMessages: Boolean(state.activeAdminContactConversationId) }, 0);
}, 5000);

// --- 5. Realtime subscriptions -----------------------------------------------
supabase
	.channel("admin-realtime-updates")
	.on("postgres_changes", { event: "*", schema: "public", table: "sports_leaderboard" }, () => {
		scheduleAdminRealtimeReload({ teams: true, participants: true, overview: true }, 0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "participants" }, () => {
		scheduleAdminRealtimeReload({ participants: true, teams: true, overview: true }, 0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "scheduled_matches" }, () => {
		scheduleAdminRealtimeReload({ overview: true }, 0, { force: true });
		scheduleAdminMessagingReload({ conversations: true }, 100);
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "sports" }, () => {
		scheduleAdminRealtimeReload({ sports: true, participants: true, accounts: true, contacts: true, overview: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () => {
		scheduleAdminRealtimeReload({ overview: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "student_feedback" }, () => {
		scheduleAdminRealtimeReload({ feedback: true }, 0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, refreshAdminAnnouncementsRealtime)
	.on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => {
		scheduleAdminRealtimeReload({ accounts: true, contacts: true }, 0, { force: true });
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "messages" }, payload => {
		const changedConversationId = payload.new?.conversation_id || payload.old?.conversation_id;
		const shouldReloadOpenThread = (state.activeAdminContactConversationIds || [])
			.some(conversationId => String(conversationId) === String(changedConversationId || ""));
		if (payload.eventType === "INSERT" && String(payload.new?.receiver_id || "") === String(state.currentAdminUser?.id || "") && changedConversationId) {
			state.adminLatestUnreadMessages.set(String(changedConversationId), payload.new);
			updateAdminMessageNotification();
		}
		scheduleAdminMessagingReload({
			contactMessages: Boolean(shouldReloadOpenThread),
			conversations: true
		}, 100);
	})
	.on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
		scheduleAdminMessagingReload({ conversations: true }, 100);
	})
	.subscribe();
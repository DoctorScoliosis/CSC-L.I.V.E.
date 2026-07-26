/*
 * Overview tab for the Admin dashboard.
 *
 * Owns the twelve stat cards, the match-status / attendance / recent-matches
 * / team-summary / sports-summary tables, and the match delete-request
 * approve/reject workflow. Many other admin features call
 * loadAdminOverviewCounts() after a write, so this module is a dependency
 * for participants, teams, sports, and matches — it must not import them.
 */

import {
	state,
	dom,
	supabase,
	TEAMS_TABLE,
	TEAM_NAME_COLUMN,
	PARTICIPANTS_TABLE,
	PARTICIPANT_TEAM_COLUMN,
	MATCHES_TABLE,
	SPORTS_TABLE,
	ATTENDANCE_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE
} from "../pages/admin-context.js";
import { normalizeParticipantStatus, normalizeGameType, getSportGameTypeLabel } from "../pages/admin-helpers.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import { getLocalISODate } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";

// --- Counting helpers --------------------------------------------------------
async function countRows(tableName, options = {}) {
	const { silent = false } = options;
	const { count, error } = await supabase
		.from(tableName)
		.select("*", {
			count: "exact",
			head: true
		});
	if (error) {
		if (!silent) {
			console.error(`Error counting ${tableName}:`, error.message || error);
		}
		return 0;
	}
	return count || 0;
}

async function getParticipantCount(teamName) {
	const { count, error } = await supabase
		.from(PARTICIPANTS_TABLE)
		.select("*", {
			count: "exact",
			head: true
		})
		.eq(PARTICIPANT_TEAM_COLUMN, teamName);
	if (error) {
		console.error("Error counting participants:", error.message || error);
		return 0;
	}
	return count || 0;
}

async function countMatchesByStatus(statusValue) {
	const { count, error } = await supabase
		.from(MATCHES_TABLE)
		.select("*", {
			count: "exact",
			head: true
		})
		.eq("status", statusValue);
	if (error) {
		console.error(`Error counting ${statusValue} matches:`, error.message || error);
		return 0;
	}
	return count || 0;
}

async function loadOverviewMatches() {
	const matchSelectWithRelations = `
	id,
	sport_id,
	team_one_id,
	team_two_id,
	match_time,
	location,
	status,
	created_at,
	delete_requested,
	delete_requested_at,
	delete_requested_by,
	delete_requested_by_name,
	delete_approved,
	delete_approved_at,
	delete_rejected,
	delete_rejected_at,
	sport:sports!scheduled_matches_sport_id_fkey(id, sport_name),
	team_one:sports_leaderboard!scheduled_matches_team_one_fkey(team),
	team_two:sports_leaderboard!scheduled_matches_team_two_fkey(team)
	`;
	const { data, error } = await supabase
		.from(MATCHES_TABLE)
		.select(matchSelectWithRelations)
		.order("match_time", { ascending: true });
	if (!error) {
		return data || [];
	}
	console.warn("Overview relation match load failed. Falling back to plain scheduled_matches select:", error.message || error);
	const fallback = await supabase
		.from(MATCHES_TABLE)
		.select("*")
		.order("match_time", { ascending: true });
	if (fallback.error) {
		console.error("Error loading overview matches:", fallback.error.message || fallback.error);
		return [];
	}
	return fallback.data || [];
}

async function loadTodayAttendanceRows() {
	const today = getLocalISODate();
	const { data, error } = await supabase
		.from(ATTENDANCE_TABLE)
		.select("id, participant_name, student_id, team, status, attendance_date, checked_at")
		.eq("attendance_date", today)
		.order("checked_at", { ascending: false });
	if (error) {
		console.error("Error loading today's attendance records:", error.message || error);
		return [];
	}
	return data || [];
}

// --- Small formatting helpers ------------------------------------------------
function setOverviewText(element, value) {
	if (element) {
		const nextValue = String(value);
		if (element.textContent !== nextValue) {
			element.textContent = nextValue;
		}
	}
}

function normalizeText(value) {
	return String(value || "").trim().toLowerCase();
}

function getOverviewTeamName(match, side) {
	if (side === "one") {
		return match.team_one?.team || match.team_one_name || "Team 1";
	}
	return match.team_two?.team || match.team_two_name || "Team 2";
}

function getOverviewSportName(match) {
	return match.sport?.sport_name || match.sport_name || "Unknown Sport";
}

function isMatchDeleteRequested(match) {
	const value = match?.delete_requested;
	return value === true || normalizeText(value) === "true";
}

function getStatusBadge(status) {
	if (status === "Ongoing") {
		return "bg-red-100 text-red-700";
	}
	if (status === "Done") {
		return "bg-green-100 text-green-700";
	}
	return "bg-blue-100 text-blue-700";
}

export function renderEmptyRow(tbody, colspan, message) {
	if (!tbody) {
		return;
	}
	tbody.innerHTML = `
	<tr>
	<td colspan="${colspan}" class="py-4 px-4 text-gray-600">
	${escapeHTML(message)}
	</td>
	</tr>
	`;
}

// --- Renderers ---------------------------------------------------------------
function renderOverviewMatchStatus(totalMatches, upcomingMatches, activeGames, completedMatches, todayMatches) {
	if (!dom.overviewMatchStatusBody) {
		return;
	}
	const rows = [
		{ category: "All scheduled matches", status: "All", count: totalMatches, badge: "bg-gray-100 text-gray-700" },
		{ category: "Upcoming matches", status: "Next", count: upcomingMatches, badge: "bg-blue-100 text-blue-700" },
		{ category: "Currently active games", status: "Ongoing", count: activeGames, badge: "bg-red-100 text-red-700" },
		{ category: "Finished games", status: "Done", count: completedMatches, badge: "bg-green-100 text-green-700" },
		{ category: "Matches scheduled today", status: "Today", count: todayMatches, badge: "bg-yellow-100 text-yellow-700" }
	];
	dom.overviewMatchStatusBody.innerHTML = rows.map(row => `
	<tr class="border-b border-gray-100 hover:bg-gray-50">
	<td class="py-3 px-4 font-medium text-gray-900">${escapeHTML(row.category)}</td>
	<td class="py-3 px-4">
	<span class="inline-flex px-2 py-1 rounded-full text-xs font-semibold ${row.badge}">
	${escapeHTML(row.status)}
	</span>
	</td>
	<td class="py-3 px-4 text-right font-bold text-gray-900">${row.count}</td>
	</tr>
	`).join("");
}

function renderOverviewAttendance(attendanceRows) {
	if (!dom.overviewAttendanceBody) {
		return;
	}
	if (!attendanceRows.length) {
		renderEmptyRow(dom.overviewAttendanceBody, 4, "No participant attendance records checked today.");
		return;
	}
	dom.overviewAttendanceBody.innerHTML = attendanceRows.slice(0, 8).map(row => `
	<tr class="border-b border-gray-100 hover:bg-gray-50">
	<td class="py-3 px-4 font-medium text-gray-900">${escapeHTML(row.participant_name || "No name")}</td>
	<td class="py-3 px-4 text-gray-600">${escapeHTML(row.student_id || "-")}</td>
	<td class="py-3 px-4 text-gray-600">${escapeHTML(row.team || "-")}</td>
	<td class="py-3 px-4 text-gray-600">${escapeHTML(formatDateTime(row.checked_at))}</td>
	</tr>
	`).join("");
}

function renderOverviewRecentMatches(matches) {
	if (!dom.overviewRecentMatchesBody) {
		return;
	}
	if (!matches.length) {
		renderEmptyRow(dom.overviewRecentMatchesBody, 6, "No scheduled matches found.");
		return;
	}
	const sortByStatusAndSchedule = (a, b) => {
		const statusOrder = { Ongoing: 0, Next: 1, Done: 2 };
		const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
		if (statusDiff !== 0) {
			return statusDiff;
		}
		return new Date(a.match_time || 0) - new Date(b.match_time || 0);
	};
	const pendingDeleteMatches = matches
		.filter(match => isMatchDeleteRequested(match))
		.sort((a, b) => new Date(b.delete_requested_at || b.created_at || 0) - new Date(a.delete_requested_at || a.created_at || 0));
	const regularMatches = matches
		.filter(match => !isMatchDeleteRequested(match))
		.sort(sortByStatusAndSchedule);
	const displayLimit = Math.max(8, pendingDeleteMatches.length);
	const displayMatches = [...pendingDeleteMatches, ...regularMatches].slice(0, displayLimit);
	dom.overviewRecentMatchesBody.innerHTML = displayMatches.map(match => {
		const deleteRequestCell = isMatchDeleteRequested(match) ? `
		<div class="space-y-2">
		<div>
		<span class="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
		Pending
		</span>
		<p class="mt-1 text-xs text-gray-500">
		${escapeHTML(match.delete_requested_by_name || "Committee")}
		</p>
		</div>
		<div class="flex flex-wrap gap-1">
		<button
		type="button"
		data-match-id="${match.id}"
		class="approve-match-delete-btn px-2 py-1 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700">
		Approve
		</button>
		<button
		type="button"
		data-match-id="${match.id}"
		class="reject-match-delete-btn px-2 py-1 rounded bg-gray-700 text-white text-xs font-semibold hover:bg-gray-800">
		Reject
		</button>
		</div>
		</div>
		` : `
		<span class="text-xs text-gray-400">No request</span>
		`;
		return `
		<tr class="border-b border-gray-100 hover:bg-gray-50 ${isMatchDeleteRequested(match) ? "bg-amber-50/60" : ""}">
		<td class="py-3 px-4 font-medium text-gray-900">${escapeHTML(getOverviewSportName(match))}</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(getOverviewTeamName(match, "one"))}
		<span class="font-semibold text-gray-400">vs</span>
		${escapeHTML(getOverviewTeamName(match, "two"))}
		</td>
		<td class="py-3 px-4 text-gray-600">${escapeHTML(formatDateTime(match.match_time))}</td>
		<td class="py-3 px-4 text-gray-600">${escapeHTML(match.location || "No location set")}</td>
		<td class="py-3 px-4">
		<span class="inline-flex px-2 py-1 rounded-full text-xs font-semibold ${getStatusBadge(match.status)}">
		${escapeHTML(match.status || "Next")}
		</span>
		</td>
		<td class="py-3 px-4">${deleteRequestCell}</td>
		</tr>
		`;
	}).join("");
	bindMatchDeleteApprovalButtons();
}

function renderOverviewTeamSummary(teams, participants) {
	if (!dom.overviewTeamSummaryBody) {
		return;
	}
	if (!teams.length) {
		renderEmptyRow(dom.overviewTeamSummaryBody, 2, "No teams found.");
		return;
	}
	const summary = teams.map(team => {
		const teamName = team[TEAM_NAME_COLUMN] || "Unknown Team";
		const members = participants.filter(participant => {
			return normalizeText(participant[PARTICIPANT_TEAM_COLUMN]) === normalizeText(teamName);
		}).length;
		return {
			teamName,
			members
		};
	}).sort((a, b) => {
		if (b.members !== a.members) {
			return b.members - a.members;
		}
		return a.teamName.localeCompare(b.teamName);
	});
	dom.overviewTeamSummaryBody.innerHTML = summary.map(row => `
	<tr class="border-b border-gray-100 hover:bg-gray-50">
	<td class="py-3 px-4 font-medium text-gray-900">${escapeHTML(row.teamName)}</td>
	<td class="py-3 px-4 text-right font-bold text-gray-900">${row.members}</td>
	</tr>
	`).join("");
}

function renderOverviewSportsSummary(sports) {
	if (!dom.overviewSportsSummaryBody) {
		return;
	}
	if (!sports.length) {
		renderEmptyRow(dom.overviewSportsSummaryBody, 2, "No sports or game categories found.");
		return;
	}
	dom.overviewSportsSummaryBody.innerHTML = sports.map(sport => `
	<tr class="border-b border-gray-100 hover:bg-gray-50">
	<td class="py-3 px-4 font-medium text-gray-900">${escapeHTML(sport.sport_name || "Unnamed Sport")}</td>
	<td class="py-3 px-4 text-right text-gray-600">${escapeHTML(getSportGameTypeLabel(sport.game_type))}</td>
	</tr>
	`).join("");
}

// --- Delete-request workflow -------------------------------------------------
export async function approveMatchDelete(matchId) {
	const shouldApprove = await showDashboardConfirm("Approve this delete request? This will permanently remove the match and its game history.", {
		title: "Approve Delete Request",
		confirmText: "Approve Delete"
	});
	if (!shouldApprove) {
		return;
	}
	try {
		const { error: playerStatsDeleteError } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.delete()
			.eq("match_id", matchId);
		if (playerStatsDeleteError) {
			throw playerStatsDeleteError;
		}
		const { error: historyDeleteError } = await supabase
			.from(GAME_HISTORY_TABLE)
			.delete()
			.eq("match_id", matchId);
		if (historyDeleteError) {
			throw historyDeleteError;
		}
		const { error: matchDeleteError } = await supabase
			.from(MATCHES_TABLE)
			.delete()
			.eq("id", matchId)
			.eq("delete_requested", true);
		if (matchDeleteError) {
			throw matchDeleteError;
		}
		state.adminPendingDeleteRequests = state.adminPendingDeleteRequests.filter(match => Number(match.id) !== Number(matchId));
		showDashboardToast("Delete request approved. Match removed.");
		await loadAdminOverviewCounts();
	} catch (error) {
		console.error("Approve match delete error:", error.message || error);
		alert(error.message || "Failed to approve delete request.");
	}
}

export async function rejectMatchDelete(matchId) {
	const shouldReject = await showDashboardConfirm("Reject this delete request and keep the match?", {
		title: "Reject Delete Request",
		confirmText: "Reject Request"
	});
	if (!shouldReject) {
		return;
	}
	try {
		const { error } = await supabase
			.from(MATCHES_TABLE)
			.update({
				delete_requested: false,
				delete_rejected: true,
				delete_rejected_at: new Date().toISOString(),
				delete_rejected_by: "admin"
			})
			.eq("id", matchId)
			.eq("delete_requested", true);
		if (error) {
			throw error;
		}
		showDashboardToast("Delete request rejected. Match kept.", "warning");
		await loadAdminOverviewCounts();
	} catch (error) {
		console.error("Reject match delete error:", error.message || error);
		alert(error.message || "Failed to reject delete request.");
	}
}

function bindMatchDeleteApprovalButtons() {
	document.querySelectorAll(".approve-match-delete-btn").forEach(button => {
		button.addEventListener("click", () => approveMatchDelete(Number(button.dataset.matchId)));
	});
	document.querySelectorAll(".reject-match-delete-btn").forEach(button => {
		button.addEventListener("click", () => rejectMatchDelete(Number(button.dataset.matchId)));
	});
}

// --- Main loader -------------------------------------------------------------
export async function loadAdminOverviewCounts(options = {}) {
	const { showLoading = false } = options;
	const shouldShowLoading = showLoading && !state.hasLoadedAdminOverview;
	if (shouldShowLoading) {
		[
			dom.adminTotalTeams,
			dom.adminTotalSports,
			dom.adminTotalParticipants,
			dom.adminTotalMatches,
			dom.adminUpcomingMatches,
			dom.adminActiveGames,
			dom.adminCompletedMatches,
			dom.adminTotalDays,
			dom.adminApprovedParticipants,
			dom.adminPendingParticipants,
			dom.adminRejectedParticipants,
			dom.adminTodayAttendance
		].forEach(element => setOverviewText(element, "Loading..."));
		renderEmptyRow(dom.overviewMatchStatusBody, 3, "Loading match status summary...");
		renderEmptyRow(dom.overviewAttendanceBody, 4, "Loading attendance records...");
		renderEmptyRow(dom.overviewRecentMatchesBody, 6, "Loading latest matches...");
		renderEmptyRow(dom.overviewTeamSummaryBody, 2, "Loading team summary...");
		renderEmptyRow(dom.overviewSportsSummaryBody, 4, "Loading sports summary...");
	}
	const [
		teamsResult,
		sportsResult,
		participantsResult,
		matches,
		attendanceRows
	] = await Promise.all([
		supabase
			.from(TEAMS_TABLE)
			.select(`id, ${TEAM_NAME_COLUMN}`)
			.order(TEAM_NAME_COLUMN, { ascending: true }),
		supabase
			.from(SPORTS_TABLE)
			.select("id, sport_name, game_type, created_at, updated_at")
			.order("sport_name", { ascending: true }),
		supabase
			.from(PARTICIPANTS_TABLE)
			.select("id, name, student_id, team, status, created_at")
			.order("created_at", { ascending: false }),
		loadOverviewMatches(),
		loadTodayAttendanceRows()
	]);
	if (teamsResult.error) {
		console.error("Overview teams load error:", teamsResult.error.message || teamsResult.error);
	}
	if (sportsResult.error) {
		console.error("Overview sports load error:", sportsResult.error.message || sportsResult.error);
	}
	if (participantsResult.error) {
		console.error("Overview participants load error:", participantsResult.error.message || participantsResult.error);
	}
	const teams = teamsResult.data || [];
	const sports = sportsResult.data || [];
	const participants = participantsResult.data || [];
	const today = getLocalISODate();
	const totalTeams = teams.length;
	const totalSports = sports.length;
	const totalParticipants = participants.length;
	const totalMatches = matches.length;
	const upcomingMatches = matches.filter(match => match.status === "Next").length;
	const activeGames = matches.filter(match => match.status === "Ongoing").length;
	const completedMatches = matches.filter(match => match.status === "Done").length;
	state.adminPendingDeleteRequests = matches.filter(match => isMatchDeleteRequested(match));
	const approvedParticipants = participants.filter(participant => normalizeParticipantStatus(participant.status) === "approved").length;
	const pendingParticipants = participants.filter(participant => normalizeParticipantStatus(participant.status) === "pending").length;
	const rejectedParticipants = participants.filter(participant => normalizeParticipantStatus(participant.status) === "rejected").length;
	const uniqueMatchDays = new Set(
		matches
			.filter(match => match.match_time)
			.map(match => new Date(match.match_time).toLocaleDateString("en-CA"))
	).size;
	const todayMatches = matches.filter(match => {
		if (!match.match_time) {
			return false;
		}
		return new Date(match.match_time).toLocaleDateString("en-CA") === today;
	}).length;
	setOverviewText(dom.adminTotalTeams, totalTeams);
	setOverviewText(dom.adminTotalSports, totalSports);
	setOverviewText(dom.adminTotalParticipants, totalParticipants);
	setOverviewText(dom.adminTotalMatches, totalMatches);
	setOverviewText(dom.adminUpcomingMatches, upcomingMatches);
	setOverviewText(dom.adminActiveGames, activeGames);
	setOverviewText(dom.adminCompletedMatches, completedMatches);
	setOverviewText(dom.adminTotalDays, uniqueMatchDays);
	setOverviewText(dom.adminApprovedParticipants, approvedParticipants);
	setOverviewText(dom.adminPendingParticipants, pendingParticipants);
	setOverviewText(dom.adminRejectedParticipants, rejectedParticipants);
	setOverviewText(dom.adminTodayAttendance, attendanceRows.length);
	if (dom.adminOverviewLastUpdated) {
		dom.adminOverviewLastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;
	}
	renderOverviewMatchStatus(totalMatches, upcomingMatches, activeGames, completedMatches, todayMatches);
	renderOverviewAttendance(attendanceRows);
	renderOverviewRecentMatches(matches);
	renderOverviewTeamSummary(teams, participants);
	renderOverviewSportsSummary(sports);
	state.hasLoadedAdminOverview = true;
}
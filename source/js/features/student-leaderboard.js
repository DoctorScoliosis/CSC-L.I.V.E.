/*
 * Leaderboard orchestration + team history modal for the Student dashboard.
 *
 * The actual leaderboard computation and row rendering live in the shared
 * features/leaderboard.js (reused by the Committee dashboard). This module
 * owns the student-specific pieces: the load orchestration (teams + game
 * history + attendance bonus), the signature-based skip when nothing
 * changed, and the team-details modal with merit/demerit history.
 */

import {
	supabase,
	state,
	dom,
	TEAMS_TABLE,
	ATTENDANCE_TABLE,
	GAME_HISTORY_TABLE
} from "../pages/student-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTimeShort as formatDateTime } from "../utils/datetime.js";
import { buildLeaderboardRows, renderLeaderboardRows } from "./leaderboard.js";

function normalizeText(value) {
	return String(value ?? "").trim().toLowerCase();
}

function findFiniteNumber(...values) {
	for (const value of values) {
		if (value === null || value === undefined || value === "") {
			continue;
		}
		const numericValue = Number(value);
		if (Number.isFinite(numericValue)) {
			return { found: true, value: numericValue };
		}
	}
	return { found: false, value: 0 };
}

function resolveHistoryPoints(history, side) {
	const explicitWinnerPoints = findFiniteNumber(
		history.winner_points_awarded,
		history.winner_award,
		history.winner_points,
		history.points_winner,
		history.winning_points
	);
	const explicitLoserPoints = findFiniteNumber(
		history.loser_points_awarded,
		history.loser_award,
		history.loser_points,
		history.points_loser,
		history.losing_points
	);
	if (side === "winner" && explicitWinnerPoints.found) {
		return explicitWinnerPoints.value;
	}
	if (side === "loser" && explicitLoserPoints.found) {
		return explicitLoserPoints.value;
	}
	return 0;
}

export async function loadLeaderboard(options = {}) {
	if (state.isLoadingLeaderboard) {
		state.shouldReloadLeaderboardAgain = true;
		return;
	}
	state.isLoadingLeaderboard = true;
	state.shouldReloadLeaderboardAgain = false;
	const shouldShowLoading = state.lastLeaderboardRows.length === 0;
	if (shouldShowLoading) {
		dom.studentLeaderboardBody.innerHTML = `
		<tr>
		<td colspan="5" class="text-center py-16">
		<div class="flex flex-col items-center space-y-3">
		<div class="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
		<p class="text-slate-500 font-medium">Updating leaderboard...</p>
		</div>
		</td>
		</tr>
		`;
	}
	try {
		const { data: teams, error: teamsError } = await supabase
			.from(TEAMS_TABLE)
			.select("*")
			.order("team", { ascending: true });
		if (teamsError) {
			console.error("Leaderboard teams error:", teamsError.message || teamsError);
			if (state.lastLeaderboardRows.length > 0) {
				renderLeaderboardRows(dom.studentLeaderboardBody, state.lastLeaderboardRows, {
					onTeamClick: (team) => openTeamDetails(team, state.lastLeaderboardHistoryRows)
				});
			} else {
				dom.studentLeaderboardBody.innerHTML = `
				<tr>
				<td colspan="5" class="text-center py-16 text-red-500 font-bold">
				Failed to load teams. Please check Supabase RLS and the sports_leaderboard table.
				</td>
				</tr>
				`;
			}
			return;
		}
		const [
			{ data: historyRows, error: historyError },
			{ data: attendanceRows, error: attendanceError }
		] = await Promise.all([
			supabase.from(GAME_HISTORY_TABLE).select("*"),
			supabase.from(ATTENDANCE_TABLE).select("student_id, participant_id, team, home_college, status, attendance_date, checked_at")
		]);
		if (historyError) {
			console.warn("Leaderboard game history warning:", historyError.message || historyError);
		}
		if (attendanceError) {
			console.warn("Leaderboard attendance bonus warning:", attendanceError.message || attendanceError);
		}
		const leaderboardRows = buildLeaderboardRows(
			teams || [],
			historyError ? [] : (historyRows || []),
			attendanceError ? [] : (attendanceRows || [])
		);
		const leaderboardSignature = JSON.stringify(leaderboardRows);
		state.lastLeaderboardRows = leaderboardRows;
		state.lastLeaderboardHistoryRows = historyError ? [] : (historyRows || []);
		if (leaderboardSignature !== state.lastLeaderboardSignature) {
			renderLeaderboardRows(dom.studentLeaderboardBody, leaderboardRows, {
				onTeamClick: (team) => openTeamDetails(team, state.lastLeaderboardHistoryRows)
			});
			state.lastLeaderboardSignature = leaderboardSignature;
		}
	} catch (error) {
		console.error("Leaderboard load error:", error.message || error);
		if (state.lastLeaderboardRows.length > 0) {
			renderLeaderboardRows(dom.studentLeaderboardBody, state.lastLeaderboardRows, {
				onTeamClick: (team) => openTeamDetails(team, state.lastLeaderboardHistoryRows)
			});
		} else {
			dom.studentLeaderboardBody.innerHTML = `
			<tr>
			<td colspan="5" class="text-center py-16 text-red-500 font-bold">
			Failed to load leaderboard. Please check your Supabase tables and policies.
			</td>
			</tr>
			`;
		}
	} finally {
		state.isLoadingLeaderboard = false;
		if (state.shouldReloadLeaderboardAgain) {
			state.shouldReloadLeaderboardAgain = false;
			await loadLeaderboard({ showLoading: false });
		}
	}
}

// --- Team details modal ------------------------------------------------------

export function openTeamDetails(team, historyRows) {
	const teamId = team.id;
	const teamName = team.team;
	const normalizeTeamName = (n) => String(n || "").trim().toLowerCase();
	const selectedName = normalizeTeamName(teamName);
	const teamHistory = (historyRows || []).filter(h =>
		(h.winner_team_id && Number(h.winner_team_id) === Number(teamId)) ||
		(h.loser_team_id && Number(h.loser_team_id) === Number(teamId)) ||
		normalizeTeamName(h.winner_team_name) === selectedName ||
		normalizeTeamName(h.loser_team_name) === selectedName
	);
	const sortedHistory = teamHistory.sort((a, b) => new Date(b.declared_at || b.created_at) - new Date(a.declared_at || a.created_at));
	const getHistorySportName = (game) => game.sport_name || game.sport?.sport_name || game.game_category || game.category || "Uncategorized";
	const getTeamAdjustments = (game) => {
		const isTeamOne = (game.team_one_id && Number(game.team_one_id) === Number(teamId))
			|| (selectedName && normalizeTeamName(game.team_one_name) === selectedName);
		const isTeamTwo = (game.team_two_id && Number(game.team_two_id) === Number(teamId))
			|| (selectedName && normalizeTeamName(game.team_two_name) === selectedName);
		if (isTeamOne) {
			return {
				merit: Number(game.team_one_merit_points) || 0,
				meritRemarks: game.team_one_merit_remarks || "",
				demerit: Number(game.team_one_demerit_points) || 0,
				demeritRemarks: game.team_one_demerit_remarks || ""
			};
		}
		if (isTeamTwo) {
			return {
				merit: Number(game.team_two_merit_points) || 0,
				meritRemarks: game.team_two_merit_remarks || "",
				demerit: Number(game.team_two_demerit_points) || 0,
				demeritRemarks: game.team_two_demerit_remarks || ""
			};
		}
		return { merit: 0, meritRemarks: "", demerit: 0, demeritRemarks: "" };
	};
	const meritTotal = sortedHistory.reduce((sum, game) => sum + getTeamAdjustments(game).merit, 0);
	const demeritTotal = sortedHistory.reduce((sum, game) => sum + getTeamAdjustments(game).demerit, 0);
	const historyCategories = [...new Set(sortedHistory.map(getHistorySportName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	const hasAdjustmentRecord = (game, adjustmentFilter) => {
		const adjustments = getTeamAdjustments(game);
		return adjustmentFilter === "Merit"
			? adjustments.merit > 0 || Boolean(String(adjustments.meritRemarks || "").trim())
			: adjustments.demerit > 0 || Boolean(String(adjustments.demeritRemarks || "").trim());
	};
	const renderHistoryCards = (category = "All", adjustmentFilter = "All") => {
		let visibleHistory = category === "All"
			? sortedHistory
			: sortedHistory.filter(game => getHistorySportName(game) === category);
		if (adjustmentFilter === "Merit") {
			visibleHistory = visibleHistory.filter(game => hasAdjustmentRecord(game, "Merit"));
		} else if (adjustmentFilter === "Demerit") {
			visibleHistory = visibleHistory.filter(game => hasAdjustmentRecord(game, "Demerit"));
		}
		if (visibleHistory.length === 0) {
			const emptyMessage = adjustmentFilter === "All"
				? "No match history found for this game category."
				: `No ${adjustmentFilter.toLowerCase()} history or remarks found for this game category.`;
			return `<p class="text-center py-8 text-slate-500 italic">${emptyMessage}</p>`;
		}
		return visibleHistory.map(game => {
			const isWin = (game.winner_team_id && Number(game.winner_team_id) === Number(teamId)) || normalizeTeamName(game.winner_team_name) === selectedName;
			const opponent = isWin ? game.loser_team_name : game.winner_team_name;
			const adjustments = getTeamAdjustments(game);
			if (adjustmentFilter !== "All") {
				const isMerit = adjustmentFilter === "Merit";
				const adjustmentPoints = isMerit ? adjustments.merit : adjustments.demerit;
				const adjustmentRemarks = isMerit ? adjustments.meritRemarks : adjustments.demeritRemarks;
				const adjustmentTone = isMerit
					? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
					: "border-red-200 bg-red-50/70 text-red-900";
				const adjustmentSign = isMerit ? "+" : "-";
				return `
				<div class="p-5 rounded-2xl border ${adjustmentTone}">
				<div class="flex justify-between items-start gap-3 mb-4">
				<div>
				<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">${escapeHTML(getHistorySportName(game))}</p>
				<p class="font-black text-slate-950 text-lg">vs ${escapeHTML(opponent || "Unknown Opponent")}</p>
				</div>
				<span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter bg-white/80">
				${adjustmentFilter}
				</span>
				</div>
				<div class="grid grid-cols-1 gap-3 text-sm">
				<div class="bg-white/80 p-3 rounded-xl border border-white">
				<p class="text-[10px] font-bold text-slate-600 uppercase mb-1">${adjustmentFilter} Points</p>
				<p class="font-black text-xl">${adjustmentSign}${Number(adjustmentPoints || 0).toLocaleString()}</p>
				</div>
				<div class="bg-white/80 p-3 rounded-xl border border-white">
				<p class="text-[10px] font-bold text-slate-600 uppercase mb-1">Remarks</p>
				<p class="font-bold text-slate-950">${escapeHTML(adjustmentRemarks || "No remarks recorded.")}</p>
				</div>
				<div class="bg-white/70 p-3 rounded-xl border border-white">
				<p class="text-[10px] font-bold text-slate-600 uppercase mb-1">Date</p>
				<p class="font-bold text-slate-950">${formatDateTime(game.declared_at || game.match_time)}</p>
				</div>
				</div>
				</div>
				`;
			}
			return `
			<div class="p-5 rounded-2xl border ${isWin ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'} relative overflow-hidden">
			<div class="flex justify-between items-start gap-3 mb-4">
			<div>
			<p class="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-1">${escapeHTML(getHistorySportName(game))}</p>
			<p class="font-black text-slate-950 text-lg">vs ${escapeHTML(opponent)}</p>
			</div>
			<span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${isWin ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
			${isWin ? 'Victory' : 'Defeated'}
			</span>
			</div>
			<div class="grid grid-cols-2 gap-4 text-sm">
			<div class="bg-white/70 p-3 rounded-xl border border-slate-200">
			<p class="text-[10px] font-bold text-slate-600 uppercase mb-1">Points Earned</p>
			<p class="font-bold text-slate-950">+${resolveHistoryPoints(game, isWin ? "winner" : "loser")}</p>
			</div>
			<div class="bg-white/70 p-3 rounded-xl border border-slate-200">
			<p class="text-[10px] font-bold text-slate-600 uppercase mb-1">Date</p>
			<p class="font-bold text-slate-950">${formatDateTime(game.match_time)}</p>
			</div>
			<div class="bg-white/70 p-3 rounded-xl border border-emerald-200">
			<p class="text-[10px] font-bold text-emerald-600 uppercase mb-1">Merit</p>
			<p class="font-bold text-emerald-800">+${Number(adjustments.merit || 0).toLocaleString()}</p>
			${adjustments.meritRemarks ? `<p class="mt-1 text-xs text-slate-500">${escapeHTML(adjustments.meritRemarks)}</p>` : ""}
			</div>
			<div class="bg-white/70 p-3 rounded-xl border border-red-200">
			<p class="text-[10px] font-bold text-red-600 uppercase mb-1">Demerit</p>
			<p class="font-bold text-red-800">-${Number(adjustments.demerit || 0).toLocaleString()}</p>
			${adjustments.demeritRemarks ? `<p class="mt-1 text-xs text-slate-500">${escapeHTML(adjustments.demeritRemarks)}</p>` : ""}
			</div>
			</div>
			<div class="mt-4 bg-white/75 p-3 rounded-xl border border-slate-200 text-sm">
			<p class="text-[10px] font-bold text-slate-600 uppercase mb-1">Player of the Game</p>
			<p class="font-bold text-slate-950">${escapeHTML(game.best_player || "Not recorded")}</p>
			</div>
			</div>
			`;
		}).join("");
	};
	dom.matchDetailsModal.classList.remove("hidden");
	dom.matchDetailsModal.classList.add("flex");
	dom.matchDetailsTitle.textContent = `${teamName} - Performance History`;
	const formattedTeamPoints = Number(team.points || 0).toLocaleString();
	dom.matchDetailsContent.innerHTML = `
	<div class="space-y-8">
	<div class="grid grid-cols-3 gap-4">
	<div class="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-center">
	<p class="text-[10px] uppercase font-bold text-blue-600 mb-1">Total Points</p>
	<p class="team-detail-score-value text-2xl font-black text-blue-900">${formattedTeamPoints}</p>
	</div>
	<div class="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center">
	<p class="text-[10px] uppercase font-bold text-emerald-600 mb-1">Victory</p>
	<p class="team-detail-score-value text-2xl font-black text-emerald-900">${Number(team.wins || 0).toLocaleString()}</p>
	</div>
	<div class="bg-red-50 p-4 rounded-2xl border border-red-100 text-center">
	<p class="text-[10px] uppercase font-bold text-red-600 mb-1">Defeated</p>
	<p class="team-detail-score-value text-2xl font-black text-red-900">${Number(team.losses || 0).toLocaleString()}</p>
	</div>
	</div>
	<div class="grid grid-cols-2 gap-4">
	<button type="button" data-adjustment-filter="Merit" class="student-adjustment-filter bg-emerald-50 p-4 rounded-2xl border border-emerald-100 text-center">
	<p class="text-[10px] uppercase font-bold text-emerald-600 mb-1">Merit</p>
	<p class="team-detail-score-value text-2xl font-black text-emerald-900">+${Number(meritTotal || 0).toLocaleString()}</p>
	</button>
	<button type="button" data-adjustment-filter="Demerit" class="student-adjustment-filter bg-red-50 p-4 rounded-2xl border border-red-100 text-center">
	<p class="text-[10px] uppercase font-bold text-red-600 mb-1">Demerit</p>
	<p class="team-detail-score-value text-2xl font-black text-red-900">-${Number(demeritTotal || 0).toLocaleString()}</p>
	</button>
	</div>
	<div class="space-y-4">
	<h3 id="teamHistorySectionTitle" class="font-bold text-slate-950">
	Recent Match History
	</h3>
	<select
	id="teamHistoryCategoryFilter"
	class="w-full sm:w-56 rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100">
	<option value="All">All Game Categories</option>
	${historyCategories.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("")}
	</select>
	<div id="teamHistoryList" class="space-y-4">
	${renderHistoryCards("All", "All")}
	</div>
	</div>
	</div>
	`;
	const teamHistoryCategoryFilter = document.getElementById("teamHistoryCategoryFilter");
	const teamHistoryList = document.getElementById("teamHistoryList");
	const teamHistorySectionTitle = document.getElementById("teamHistorySectionTitle");
	let activeAdjustmentFilter = "All";
	const updateAdjustmentButtons = () => {
		document.querySelectorAll(".student-adjustment-filter").forEach(button => {
			const isActive = activeAdjustmentFilter === (button.dataset.adjustmentFilter || "All");
			button.classList.toggle("ring-4", isActive);
			button.classList.toggle("ring-blue-200", isActive);
			button.classList.toggle("scale-[1.01]", isActive);
		});
	};
	const renderActiveHistory = () => {
		if (teamHistorySectionTitle) {
			teamHistorySectionTitle.textContent = activeAdjustmentFilter === "All"
				? "Recent Match History"
				: `${activeAdjustmentFilter} History and Remarks`;
		}
		if (teamHistoryList) {
			teamHistoryList.innerHTML = renderHistoryCards(teamHistoryCategoryFilter?.value || "All", activeAdjustmentFilter);
		}
		updateAdjustmentButtons();
	};
	if (teamHistoryCategoryFilter && teamHistoryList) {
		teamHistoryCategoryFilter.addEventListener("change", function () {
			renderActiveHistory();
		});
	}
	document.querySelectorAll(".student-adjustment-filter").forEach(button => {
		button.addEventListener("click", function () {
			const selectedFilter = this.dataset.adjustmentFilter || "All";
			activeAdjustmentFilter = activeAdjustmentFilter === selectedFilter ? "All" : selectedFilter;
			renderActiveHistory();
			teamHistoryList?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	});
}
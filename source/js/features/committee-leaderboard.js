/*
 * Leaderboard for the Committee dashboard.
 *
 * Reuses the shared leaderboard engine (features/leaderboard.js) for the
 * points/wins/losses computation, row rendering, and rank-change animation.
 * This module owns the committee-specific pieces: the load orchestration
 * (with signature-based skip so unchanged data doesn't re-render), and the
 * team game-history modal with merit/demerit adjustments.
 */

import {
	state,
	dom,
	supabase,
	TEAMS_TABLE,
	GAME_HISTORY_TABLE,
	ATTENDANCE_TABLE
} from "../pages/committee-context.js";
import {
	buildLeaderboardRows,
	renderLeaderboardRows,
	animateLeaderboardRows
} from "./leaderboard.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTimeShort as formatDateTime } from "../utils/datetime.js";
import { normalizeStatus } from "../utils/normalize.js";

export async function loadLeaderboard(options = {}) {
	const { showLoading = false } = options;
	const hasVisibleLeaderboard = state.hasRenderedCommitteeLeaderboard
		|| dom.leaderboardBody.querySelectorAll("tr[data-team-key]").length > 0;
	if (showLoading && !hasVisibleLeaderboard) {
		dom.leaderboardBody.innerHTML = `
		<tr>
		<td colspan="5" class="text-center py-8 text-gray-500">
		Loading leaderboard from game history...
		</td>
		</tr>
		`;
	}
	/*
	Leaderboard source of truth:
	- Teams are listed from sports_leaderboard only to get the registered team names.
	- Points, wins, and losses are computed directly from game_history.
	- Attendance adds a derived +5 bonus per team/day with 100+ present records.
	- It does NOT read sports_leaderboard.points / wins / losses anymore.
	*/
	const [
		{ data: teams, error: teamsError },
		{ data: historyRows, error: historyError },
		{ data: attendanceRows, error: attendanceError }
	] = await Promise.all([
		supabase
			.from(TEAMS_TABLE)
			.select("*")
			.order("team", { ascending: true }),
		supabase
			.from(GAME_HISTORY_TABLE)
			.select("*"),
		supabase
			.from(ATTENDANCE_TABLE)
			.select("student_id, participant_id, team, home_college, status, attendance_date, checked_at")
	]);
	if (attendanceError) {
		console.warn("Leaderboard attendance bonus warning:", attendanceError.message || attendanceError);
	}
	if (teamsError) {
		console.error("Leaderboard teams error:", teamsError.message || teamsError);
		if (!hasVisibleLeaderboard) {
			dom.leaderboardBody.innerHTML = `
			<tr>
			<td colspan="5" class="text-center py-8 text-red-500">
			Failed to load registered teams.
			</td>
			</tr>
			`;
		}
		return;
	}
	if (historyError) {
		console.error("Leaderboard game history error:", historyError.message || historyError);
		if (!hasVisibleLeaderboard) {
			dom.leaderboardBody.innerHTML = `
			<tr>
			<td colspan="5" class="text-center py-8 text-red-500">
			Failed to load game history. Please check the game_history table and RLS policies.
			</td>
			</tr>
			`;
		}
		return;
	}
	const leaderboardRows = buildLeaderboardRows(
		teams || [],
		historyRows || [],
		attendanceError ? [] : (attendanceRows || [])
	);
	if (leaderboardRows.length === 0) {
		dom.leaderboardBody.innerHTML = `
		<tr>
		<td colspan="5" class="text-center py-8 text-gray-500">
		No team or game history data found.
		</td>
		</tr>
		`;
		return;
	}
	const leaderboardSignature = JSON.stringify(leaderboardRows);
	if (leaderboardSignature === state.lastCommitteeLeaderboardSignature) {
		return;
	}
	renderLeaderboardRows(dom.leaderboardBody, leaderboardRows, {
		emptyMessage: "No team or game history data found.",
		onTeamClick: team => {
			if (!team.id) {
				alert("This team has game history but no matching registered team ID.");
				return;
			}
			openHistoryModalFunction(Number(team.id), team.team);
		}
	});
	state.hasRenderedCommitteeLeaderboard = true;
	state.lastCommitteeLeaderboardSignature = leaderboardSignature;
}

export async function refreshCommitteeLeaderboard() {
	if (state.isRefreshingCommitteeLeaderboard) {
		state.shouldRefreshCommitteeLeaderboardAgain = true;
		return;
	}
	state.isRefreshingCommitteeLeaderboard = true;
	state.shouldRefreshCommitteeLeaderboardAgain = false;
	try {
		await loadLeaderboard();
	} finally {
		state.isRefreshingCommitteeLeaderboard = false;
		if (state.shouldRefreshCommitteeLeaderboardAgain) {
			state.shouldRefreshCommitteeLeaderboardAgain = false;
			await refreshCommitteeLeaderboard();
		}
	}
}

export async function openHistoryModalFunction(teamId, teamName) {
	dom.historyModal.classList.remove("hidden");
	dom.historyModal.classList.add("flex");
	dom.historyTitle.textContent = `${teamName} - Game History`;
	dom.historyContent.innerHTML = `
	<div class="text-center py-10 text-gray-500">
	Loading history...
	</div>
	`;
	const { data, error } = await supabase
		.from(GAME_HISTORY_TABLE)
		.select("*")
		.or(`winner_team_id.eq.${teamId},loser_team_id.eq.${teamId}`)
		.order("declared_at", { ascending: false });
	if (error) {
		console.error("History error:", error.message || error);
		dom.historyContent.innerHTML = `
		<div class="text-center py-10 text-gray-500">
		No game history table/data found yet.
		</div>
		`;
		return;
	}
	if (!data || data.length === 0) {
		dom.historyContent.innerHTML = `
		<div class="text-center py-10 text-gray-500">
		No game history found for this team.
		</div>
		`;
		return;
	}
	dom.historyContent.innerHTML = "";
	const sortedHistory = [...data].sort((a, b) => {
		const aIsWin = Number(a.winner_team_id) === Number(teamId) ? 1 : 0;
		const bIsWin = Number(b.winner_team_id) === Number(teamId) ? 1 : 0;
		if (bIsWin !== aIsWin) {
			return bIsWin - aIsWin;
		}
		return new Date(b.declared_at || b.created_at || 0) - new Date(a.declared_at || a.created_at || 0);
	});
	const getHistorySportName = game => game.sport_name || game.game_name || game.category_name || game.sport || "Unknown Sport";
	const getTeamAdjustments = game => {
		const normalizedTeamName = String(teamName || "").trim().toLowerCase();
		const isTeamOne = (game.team_one_id && Number(game.team_one_id) === Number(teamId))
			|| (normalizedTeamName && String(game.team_one_name || "").trim().toLowerCase() === normalizedTeamName);
		const isTeamTwo = (game.team_two_id && Number(game.team_two_id) === Number(teamId))
			|| (normalizedTeamName && String(game.team_two_name || "").trim().toLowerCase() === normalizedTeamName);
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
	const historyCategories = [...new Set(sortedHistory.map(getHistorySportName).filter(Boolean))]
		.sort((a, b) => a.localeCompare(b));
	const hasAdjustmentRecord = (game, adjustmentFilter) => {
		const adjustments = getTeamAdjustments(game);
		return adjustmentFilter === "Merit"
			? adjustments.merit > 0 || Boolean(String(adjustments.meritRemarks || "").trim())
			: adjustments.demerit > 0 || Boolean(String(adjustments.demeritRemarks || "").trim());
	};
	function renderHistoryCards(category = "All", adjustmentFilter = "All") {
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
				? "No game history found for this category."
				: `No ${adjustmentFilter.toLowerCase()} history or remarks found for this category.`;
			return `<div class="text-center py-10 text-gray-500">${emptyMessage}</div>`;
		}
		return visibleHistory.map(game => {
			const isWinner = Number(game.winner_team_id) === Number(teamId);
			const opponent = isWinner ? game.loser_team_name : game.winner_team_name;
			const resultLabel = isWinner ? "Victory" : "Defeated";
			const resultClass = isWinner
				? "bg-green-100 text-green-800"
				: "bg-red-100 text-red-800";
			const adjustments = getTeamAdjustments(game);
			if (adjustmentFilter !== "All") {
				const isMerit = adjustmentFilter === "Merit";
				const adjustmentPoints = isMerit ? adjustments.merit : adjustments.demerit;
				const adjustmentRemarks = isMerit ? adjustments.meritRemarks : adjustments.demeritRemarks;
				const adjustmentTone = isMerit
					? "border-emerald-200 bg-emerald-50 text-emerald-900"
					: "border-red-200 bg-red-50 text-red-900";
				const adjustmentSign = isMerit ? "+" : "-";
				return `
				<div class="border rounded-xl p-4 mb-4 ${adjustmentTone}">
				<div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
				<div>
				<p class="text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">${escapeHTML(getHistorySportName(game))}</p>
				<h3 class="font-bold text-lg text-gray-800">vs ${escapeHTML(opponent || "Unknown Opponent")}</h3>
				</div>
				<span class="inline-flex w-fit items-center px-3 py-1 rounded-full bg-white/80 text-sm font-bold">
				${adjustmentFilter}
				</span>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
				<div class="rounded-xl border border-white bg-white/80 p-3">
				<p class="text-gray-600">${adjustmentFilter} Points</p>
				<p class="text-xl font-black">${adjustmentSign}${Number(adjustmentPoints || 0).toLocaleString()}</p>
				</div>
				<div class="rounded-xl border border-white bg-white/80 p-3">
				<p class="text-gray-600">Date</p>
				<p class="font-semibold">${escapeHTML(formatDateTime(game.declared_at || game.match_time))}</p>
				</div>
				<div class="sm:col-span-2 rounded-xl border border-white bg-white/80 p-3">
				<p class="text-gray-600">Remarks</p>
				<p class="font-semibold">${escapeHTML(adjustmentRemarks || "No remarks recorded.")}</p>
				</div>
				</div>
				</div>
				`;
			}
			return `
			<div class="border rounded-xl p-4 mb-4 bg-gray-50">
			<div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
			<div>
			<p class="text-xs font-bold uppercase tracking-widest text-slate-600 mb-1">${escapeHTML(getHistorySportName(game))}</p>
			<h3 class="font-bold text-lg text-gray-800">
			vs ${escapeHTML(opponent || "Unknown Opponent")}
			</h3>
			</div>
			<span class="inline-flex w-fit items-center px-3 py-1 rounded-full text-sm font-medium ${resultClass}">
			${resultLabel}
			</span>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
			<div>
			<p class="text-gray-600">Winner</p>
			<p class="font-semibold">${escapeHTML(game.winner_team_name || "-")}</p>
			</div>
			<div>
			<p class="text-gray-600">Loser</p>
			<p class="font-semibold">${escapeHTML(game.loser_team_name || "-")}</p>
			</div>
			<div>
			<p class="text-gray-600">Match Time</p>
			<p class="font-semibold">${escapeHTML(formatDateTime(game.match_time))}</p>
			</div>
			<div>
			<p class="text-gray-600">Declared At</p>
			<p class="font-semibold">${escapeHTML(formatDateTime(game.declared_at))}</p>
			</div>
			<div class="sm:col-span-2">
			<p class="text-gray-600">Location</p>
			<p class="font-semibold">${escapeHTML(game.location || "No location set")}</p>
			</div>
			<div class="sm:col-span-2">
			<p class="text-gray-600">Player of the Game</p>
			<p class="font-semibold">${escapeHTML(game.best_player || "Not recorded")}</p>
			</div>
			<div>
			<p class="text-gray-600">Merit</p>
			<p class="font-semibold text-emerald-700">+${Number(adjustments.merit || 0).toLocaleString()}</p>
			${adjustments.meritRemarks ? `<p class="mt-1 text-xs text-slate-500">${escapeHTML(adjustments.meritRemarks)}</p>` : ""}
			</div>
			<div>
			<p class="text-gray-600">Demerit</p>
			<p class="font-semibold text-red-700">-${Number(adjustments.demerit || 0).toLocaleString()}</p>
			${adjustments.demeritRemarks ? `<p class="mt-1 text-xs text-slate-500">${escapeHTML(adjustments.demeritRemarks)}</p>` : ""}
			</div>
			</div>
			</div>
			`;
		}).join("");
	}
	dom.historyContent.innerHTML = `
	<div class="mb-4 grid grid-cols-2 gap-3">
	<button type="button" data-adjustment-filter="Merit" class="committee-adjustment-filter rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left">
	<p class="text-[10px] font-black uppercase tracking-widest text-emerald-700">Merit</p>
	<p class="text-2xl font-black text-emerald-900">+${Number(meritTotal || 0).toLocaleString()}</p>
	</button>
	<button type="button" data-adjustment-filter="Demerit" class="committee-adjustment-filter rounded-2xl border border-red-200 bg-red-50 p-4 text-left">
	<p class="text-[10px] font-black uppercase tracking-widest text-red-700">Demerit</p>
	<p class="text-2xl font-black text-red-900">-${Number(demeritTotal || 0).toLocaleString()}</p>
	</button>
	</div>
	<div class="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
	<h3 id="committeeHistorySectionTitle" class="font-bold text-gray-900">Recent Match History</h3>
	<select
	id="committeeHistoryCategoryFilter"
	class="w-full sm:w-56 rounded-xl border border-slate-300 bg-white/80 px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100">
	<option value="All">All Game Categories</option>
	${historyCategories.map(category => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("")}
	</select>
	</div>
	<div id="committeeHistoryList">
	${renderHistoryCards("All", "All")}
	</div>
	`;
	const committeeHistoryCategoryFilter = document.getElementById("committeeHistoryCategoryFilter");
	const committeeHistoryList = document.getElementById("committeeHistoryList");
	const committeeHistorySectionTitle = document.getElementById("committeeHistorySectionTitle");
	let activeAdjustmentFilter = "All";
	const updateAdjustmentButtons = () => {
		document.querySelectorAll(".committee-adjustment-filter").forEach(button => {
			const isActive = activeAdjustmentFilter === (button.dataset.adjustmentFilter || "All");
			button.classList.toggle("ring-4", isActive);
			button.classList.toggle("ring-blue-200", isActive);
			button.classList.toggle("scale-[1.01]", isActive);
		});
	};
	const renderActiveHistory = () => {
		if (committeeHistorySectionTitle) {
			committeeHistorySectionTitle.textContent = activeAdjustmentFilter === "All"
				? "Recent Match History"
				: `${activeAdjustmentFilter} History and Remarks`;
		}
		if (committeeHistoryList) {
			committeeHistoryList.innerHTML = renderHistoryCards(committeeHistoryCategoryFilter?.value || "All", activeAdjustmentFilter);
		}
		updateAdjustmentButtons();
	};
	if (committeeHistoryCategoryFilter && committeeHistoryList) {
		committeeHistoryCategoryFilter.addEventListener("change", function () {
			renderActiveHistory();
		});
	}
	document.querySelectorAll(".committee-adjustment-filter").forEach(button => {
		button.addEventListener("click", function () {
			const selectedFilter = this.dataset.adjustmentFilter || "All";
			activeAdjustmentFilter = activeAdjustmentFilter === selectedFilter ? "All" : selectedFilter;
			renderActiveHistory();
			committeeHistoryList?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	});
}

export function closeHistoryModalFunction() {
	dom.historyModal.classList.add("hidden");
	dom.historyModal.classList.remove("flex");
}
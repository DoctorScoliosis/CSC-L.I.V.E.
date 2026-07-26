/*
 * Basketball / volleyball score-sheet DATA + RENDERING for the Committee
 * dashboard. Read-only with respect to match state — the mutations live in
 * committee-basketball-actions.js.
 *
 * Imported by committee-match-data.js (match cards embed the sheet), so it
 * must NOT import match-data (that would be circular). The actions module
 * is the one that talks back to match-data.
 */

import { state } from "../pages/committee-context.js";
import { escapeHTML } from "../utils/dom.js";
import {
	getTeamName,
	getTeamId,
	normalizeTeamValue,
	isVolleyballSport,
	hasPlayerScoreSheet,
	getScoreSheetPeriodLimit,
	getScoreSheetPeriodLabel,
	getScoreSheetFaultLabel
} from "./committee-match-helpers.js";

export function getBasketballStatsForMatch(matchId) {
	return state.basketballStatsByMatch.get(Number(matchId)) || [];
}

export function getBasketballActivePeriod(match) {
	return Math.min(getScoreSheetPeriodLimit(match), Math.max(1, Number(match?.game_period) || 1));
}

export function getSafeBasketballStatRows(rows) {
	const mergedRows = new Map();
	(Array.isArray(rows) ? rows : []).forEach(row => {
		const playerKey = normalizeTeamValue(row.id_number || row.participant_id || row.id);
		const key = [
			row.match_id,
			row.team_id,
			Number(row.game_period || 1),
			playerKey
		].join(":");
		if (!mergedRows.has(key)) {
			mergedRows.set(key, { ...row });
			return;
		}
		const existing = mergedRows.get(key);
		mergedRows.set(key, {
			...existing,
			...row,
			points: Math.max(Number(existing.points) || 0, Number(row.points) || 0),
			fouls: Math.max(Number(existing.fouls) || 0, Number(row.fouls) || 0),
			is_active: Boolean(existing.is_active || row.is_active),
			player_name: row.player_name || existing.player_name,
			id_number: row.id_number || existing.id_number,
			participant_id: row.participant_id || existing.participant_id
		});
	});
	return Array.from(mergedRows.values());
}

export function getBasketballTeamStats(match, teamSide, gamePeriod = getBasketballActivePeriod(match)) {
	const teamId = getTeamId(match, teamSide);
	return getSafeBasketballStatRows(getBasketballStatsForMatch(match.id))
		.filter(row => Number(row.team_id) === Number(teamId))
		.filter(row => Number(row.game_period || 1) === Number(gamePeriod))
		.sort((first, second) => {
			const firstActive = first.is_active ? 1 : 0;
			const secondActive = second.is_active ? 1 : 0;
			if (firstActive !== secondActive) return secondActive - firstActive;
			const firstTime = new Date(first.created_at || 0).getTime();
			const secondTime = new Date(second.created_at || 0).getTime();
			return firstTime - secondTime;
		});
}

function sortBasketballLineupRows(rows) {
	return [...rows].sort((first, second) => {
		const firstTime = new Date(first.created_at || 0).getTime();
		const secondTime = new Date(second.created_at || 0).getTime();
		if (firstTime !== secondTime) return firstTime - secondTime;
		return String(first.id || "").localeCompare(String(second.id || ""));
	});
}

export function getBasketballLineupRows(match, teamSide) {
	const teamId = getTeamId(match, teamSide);
	const allTeamRows = getBasketballStatsForMatch(match.id)
		.filter(row => Number(row.team_id) === Number(teamId));
	const quarterOneRows = allTeamRows.filter(row => Number(row.game_period || 1) === 1);
	if (quarterOneRows.length > 0) {
		const lineupByIdNumber = new Map();
		sortBasketballLineupRows(quarterOneRows).forEach(row => {
			const key = normalizeTeamValue(row.id_number || row.participant_id);
			if (key && !lineupByIdNumber.has(key)) {
				lineupByIdNumber.set(key, row);
			}
		});
		return Array.from(lineupByIdNumber.values());
	}
	const lineupByIdNumber = new Map();
	sortBasketballLineupRows(allTeamRows).forEach(row => {
		const key = normalizeTeamValue(row.id_number || row.participant_id);
		if (key && !lineupByIdNumber.has(key)) {
			lineupByIdNumber.set(key, row);
		}
	});
	return Array.from(lineupByIdNumber.values());
}

export function getBasketballDisplayRows(match, teamSide) {
	const activePeriod = getBasketballActivePeriod(match);
	const teamId = getTeamId(match, teamSide);
	const allTeamRows = getSafeBasketballStatRows(getBasketballStatsForMatch(match.id))
		.filter(row => Number(row.team_id) === Number(teamId));
	const periodRows = allTeamRows
		.filter(row => Number(row.game_period || 1) === Number(activePeriod));
	const periodRowsByIdNumber = new Map();
	periodRows.forEach(row => {
		const key = normalizeTeamValue(row.id_number || row.participant_id);
		if (key) periodRowsByIdNumber.set(key, row);
	});
	return getBasketballLineupRows(match, teamSide)
		.map((lineupRow, lineupIndex) => {
			const key = normalizeTeamValue(lineupRow.id_number || lineupRow.participant_id);
			const periodRow = periodRowsByIdNumber.get(key) || (activePeriod === 1 ? lineupRow : null);
			const sourceRow = periodRow || lineupRow;
			const cumulativeRows = allTeamRows.filter(row =>
				normalizeTeamValue(row.id_number || row.participant_id) === key
			);
			const cumulativePoints = cumulativeRows.reduce((total, row) => total + (Number(row.points) || 0), 0);
			const cumulativeFouls = cumulativeRows.reduce((total, row) => total + (Number(row.fouls) || 0), 0);
			return {
				...sourceRow,
				id: periodRow?.id || (activePeriod === 1 ? lineupRow.id || "" : ""),
				lineup_id: lineupRow.id || "",
				id_number: lineupRow.id_number || periodRow?.id_number || "",
				player_name: lineupRow.player_name || periodRow?.player_name || "",
				participant_id: lineupRow.participant_id || periodRow?.participant_id || null,
				points: cumulativePoints,
				fouls: cumulativeFouls,
				is_active: Boolean(periodRow?.is_active),
				created_at: lineupRow.created_at || periodRow?.created_at || null,
				lineup_index: lineupIndex
			};
		})
		.sort((first, second) => {
			const firstActive = first.is_active ? 1 : 0;
			const secondActive = second.is_active ? 1 : 0;
			if (firstActive !== secondActive) return secondActive - firstActive;
			return (first.lineup_index || 0) - (second.lineup_index || 0);
		});
}

export function getBasketballTotals(match, teamSide, gamePeriod = null) {
	const teamId = getTeamId(match, teamSide);
	const rows = getSafeBasketballStatRows(getBasketballStatsForMatch(match.id))
		.filter(row => Number(row.team_id) === Number(teamId))
		.filter(row => gamePeriod === null || Number(row.game_period || 1) === Number(gamePeriod));
	return rows.reduce((totals, row) => {
		totals.points += Number(row.points) || 0;
		totals.fouls += Number(row.fouls) || 0;
		return totals;
	}, { points: 0, fouls: 0 });
}

function renderBasketballRows(match, teamSide, canManageCurrentMatch) {
	const activePeriod = getBasketballActivePeriod(match);
	const rows = getBasketballDisplayRows(match, teamSide);
	const teamId = getTeamId(match, teamSide);
	const maxRows = 12;
	return Array.from({ length: maxRows }, (_, index) => {
		const row = rows[index] || {};
		const rowKey = row.id ? `saved-${row.id}` : `blank-${teamSide}-${index}`;
		const isActive = Boolean(row.is_active);
		const hasSavedPlayer = Boolean(row.id || row.lineup_id);
		const displayValue = row.id || row.lineup_id
			? (row.player_name || row.id_number || "")
			: "";
		return `
		<tr class="border-b border-slate-200 bg-white/80">
		<td class="basketball-active-column px-2 py-1 text-center text-xs font-black">
		<button
		type="button"
		data-match-id="${match.id}"
		data-team-id="${teamId}"
		data-game-period="${activePeriod}"
		data-stat-id="${escapeHTML(row.id || "")}"
		data-lineup-stat-id="${escapeHTML(row.lineup_id || row.id || "")}"
		data-is-active="${isActive ? "true" : "false"}"
		${canManageCurrentMatch && (row.id || row.lineup_id) ? "" : "disabled"}
		title="${row.id || row.lineup_id ? `Click to mark active for this ${getScoreSheetPeriodLabel(match).toLowerCase()}` : "Save player first"}"
		class="basketball-active-player-btn inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${isActive ? "bg-green-600 text-white shadow" : row.id || row.lineup_id ? "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-green-100" : "bg-slate-200 text-slate-400 cursor-not-allowed"}">
		${index + 1}
		</button>
		</td>
		<td class="basketball-player-column px-1.5 py-1">
		<input
		type="text"
		value="${escapeHTML(displayValue)}"
		data-match-id="${match.id}"
		data-team-side="${teamSide}"
		data-team-id="${teamId}"
		data-game-period="${activePeriod}"
		data-stat-id="${escapeHTML(row.id || "")}"
		data-lineup-stat-id="${escapeHTML(row.lineup_id || row.id || "")}"
		data-id-number="${escapeHTML(row.id_number || "")}"
		data-player-name="${escapeHTML(displayValue)}"
		placeholder="Type ID number"
		title="${row.id || row.lineup_id ? "Click to show/edit ID number" : "Type ID number and press Enter"}"
		${canManageCurrentMatch ? "" : "disabled"}
		${row.id || row.lineup_id ? "readonly" : ""}
		class="basketball-score-input basketball-player-id-input ${row.id || row.lineup_id ? "cursor-pointer truncate bg-slate-50" : ""}">
		</td>
		<td class="basketball-stat-column px-2 py-1 text-center">
		<div class="basketball-score-control">
		<button
		type="button"
		data-match-id="${match.id}"
		data-team-id="${teamId}"
		data-game-period="${activePeriod}"
		data-stat-id="${escapeHTML(row.id || "")}"
		data-lineup-stat-id="${escapeHTML(row.lineup_id || row.id || "")}"
		data-id-number="${escapeHTML(row.id_number || "")}"
		data-stat-field="points"
		data-stat-amount="-1"
		${canManageCurrentMatch && hasSavedPlayer ? "" : "disabled"}
		class="basketball-score-button basketball-stat-adjust-btn ${hasSavedPlayer ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-slate-200 text-slate-400 cursor-not-allowed"}">
		-
		</button>
		<button
		type="button"
		data-match-id="${match.id}"
		data-team-id="${teamId}"
		data-game-period="${activePeriod}"
		data-team-side="${teamSide}"
		data-stat-id="${escapeHTML(row.id || "")}"
		data-lineup-stat-id="${escapeHTML(row.lineup_id || row.id || "")}"
		data-id-number="${escapeHTML(row.id_number || "")}"
		data-row-key="${escapeHTML(rowKey)}"
		${canManageCurrentMatch && hasSavedPlayer && isActive ? "" : "disabled"}
		title="${isActive ? `Add points for the active ${getScoreSheetPeriodLabel(match).toLowerCase()}` : "Select this player as active before adding points"}"
		class="basketball-score-button basketball-points-btn ${hasSavedPlayer && isActive ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}">
		${Number(row.points) || 0}
		</button>
		</div>
		</td>
		<td class="basketball-stat-column px-2 py-1 text-center">
		<div class="basketball-score-control">
		<button
		type="button"
		data-match-id="${match.id}"
		data-team-id="${teamId}"
		data-game-period="${activePeriod}"
		data-stat-id="${escapeHTML(row.id || "")}"
		data-lineup-stat-id="${escapeHTML(row.lineup_id || row.id || "")}"
		data-id-number="${escapeHTML(row.id_number || "")}"
		data-stat-field="fouls"
		data-stat-amount="-1"
		${canManageCurrentMatch && hasSavedPlayer ? "" : "disabled"}
		class="basketball-score-button basketball-stat-adjust-btn ${hasSavedPlayer ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-slate-200 text-slate-400 cursor-not-allowed"}">
		-
		</button>
		<button
		type="button"
		data-match-id="${match.id}"
		data-team-id="${teamId}"
		data-game-period="${activePeriod}"
		data-stat-id="${escapeHTML(row.id || "")}"
		data-lineup-stat-id="${escapeHTML(row.lineup_id || row.id || "")}"
		data-id-number="${escapeHTML(row.id_number || "")}"
		data-stat-field="fouls"
		data-stat-amount="1"
		${canManageCurrentMatch && hasSavedPlayer && isActive ? "" : "disabled"}
		title="${isActive ? `Add ${getScoreSheetFaultLabel(match).toLowerCase()} for the active ${getScoreSheetPeriodLabel(match).toLowerCase()}` : `Select this player as active before adding ${getScoreSheetFaultLabel(match).toLowerCase()}`}"
		class="basketball-score-button basketball-stat-adjust-btn ${hasSavedPlayer && isActive ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-slate-200 text-slate-400 cursor-not-allowed"}">
		${Number(row.fouls) || 0}
		</button>
		</div>
		</td>
		</tr>
		`;
	}).join("");
}

export function renderBasketballScoreSheet(match, canManageCurrentMatch) {
	if (!hasPlayerScoreSheet(match) || match.status !== "Ongoing") {
		return "";
	}
	const activePeriod = getBasketballActivePeriod(match);
	const isVolleyballMatch = isVolleyballSport(match);
	const scoreSheetTitle = isVolleyballMatch ? "Volleyball Score Sheet" : "Basketball Score Sheet";
	const periodLabel = getScoreSheetPeriodLabel(match);
	const faultLabel = getScoreSheetFaultLabel(match);
	const teamOneGameTotals = getBasketballTotals(match, "one");
	const teamTwoGameTotals = getBasketballTotals(match, "two");
	const teamOneQuarterTotals = getBasketballTotals(match, "one", activePeriod);
	const teamTwoQuarterTotals = getBasketballTotals(match, "two", activePeriod);
	const renderTeamSheet = (teamSide, theme) => {
		const teamName = getTeamName(match, teamSide);
		const quarterTotals = teamSide === "one" ? teamOneQuarterTotals : teamTwoQuarterTotals;
		const gameTotals = teamSide === "one" ? teamOneGameTotals : teamTwoGameTotals;
		return `
		<div class="basketball-score-team" style="--score-border:${theme.border};--score-bg:${theme.bg};">
		<div class="flex items-center justify-between gap-2 px-3 py-2">
		<h4 class="text-sm font-black uppercase ${theme.text}">${escapeHTML(teamName)}</h4>
		<div class="text-right">
		<p class="basketball-team-total text-3xl font-black leading-none ${theme.text}">${gameTotals.points}</p>
		</div>
		</div>
		<div class="basketball-score-scroll overflow-x-auto xl:overflow-x-visible">
		<table class="basketball-score-table w-full min-w-[26rem] table-fixed text-xs xl:min-w-0">
		<thead>
		<tr class="${theme.header}">
		<th class="basketball-active-column px-1 py-2 text-center">#</th>
		<th class="basketball-player-column px-1.5 py-2 text-left">Player</th>
		<th class="basketball-stat-column px-1 py-2 text-center">PTS</th>
		<th class="basketball-stat-column px-1 py-2 text-center">${faultLabel}</th>
		</tr>
		</thead>
		<tbody class="basketball-score-body">${renderBasketballRows(match, teamSide, canManageCurrentMatch)}</tbody>
		<tfoot>
		<tr class="${theme.footer}">
		<td colspan="2" class="px-2 py-2 text-sm font-black uppercase">${periodLabel} ${activePeriod} Total</td>
		<td class="px-2 py-2 text-center text-sm font-black">${quarterTotals.points}</td>
		<td class="px-2 py-2 text-center text-sm font-black">${quarterTotals.fouls}</td>
		</tr>
		</tfoot>
		</table>
		</div>
		</div>
		`;
	};
	return `
	<div class="basketball-score-sheet mb-2">
	<div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
	<div>
	<p class="text-xs font-black uppercase tracking-wide text-slate-600">${scoreSheetTitle}</p>
	<p class="text-[11px] font-semibold text-slate-500">Add the 12-player lineup once. In each ${periodLabel.toLowerCase()}, click the number button to mark active players; active players move to the top.</p>
	</div>
	<p class="text-xs font-bold text-slate-700">Game Scores: ${teamOneGameTotals.points} - ${teamTwoGameTotals.points}</p>
	</div>
	<div class="basketball-score-teams-grid grid gap-3">
	${renderTeamSheet("one", {
		border: "#93c5fd",
		bg: "#eff6ff",
		text: "text-blue-700",
		header: "bg-blue-50 text-blue-800",
		footer: "bg-blue-100 text-blue-800"
	})}
	${renderTeamSheet("two", {
		border: "#86efac",
		bg: "#f0fdf4",
		text: "text-emerald-700",
		header: "bg-emerald-50 text-emerald-800",
		footer: "bg-emerald-100 text-emerald-800"
	})}
	</div>
	</div>
	`;
}
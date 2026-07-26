/*
 * Basketball / volleyball score-sheet preview for the Student dashboard.
 *
 * Read-only preview of the live score sheet the committee manages. The
 * student page never writes to basketball_match_player_stats — it only
 * renders the active players and running totals for ongoing matches.
 *
 * Also owns the sport-type predicates (isBasketballSport etc.) used by the
 * match cards to decide whether to show a score sheet and which period
 * labels to use.
 */

import { state } from "../pages/student-context.js";
import { escapeHTML } from "../utils/dom.js";

function normalizeSportName(value) {
	return String(value || "").trim().toLowerCase();
}

function normalizeTeamValue(value) {
	return String(value || "").trim().toLowerCase();
}

export function getSportName(match) {
	return match.sport?.sport_name || match.sport_name || "Unknown Sport";
}

export function isBasketballSport(match) {
	return normalizeSportName(getSportName(match)).includes("basketball");
}

export function isVolleyballSport(match) {
	return normalizeSportName(getSportName(match)).includes("volleyball");
}

export function hasPlayerScoreSheet(match) {
	return isBasketballSport(match) || isVolleyballSport(match);
}

export function getScoreSheetPeriodLimit(match) {
	return isVolleyballSport(match) ? 5 : 4;
}

export function getScoreSheetFaultLabel(match) {
	return isVolleyballSport(match) ? "FLT" : "FLS";
}

export function getScoreSheetPeriodLabel(match) {
	return isVolleyballSport(match) ? "set" : "quarter";
}

export function getTeamId(match, teamSide) {
	return Number(teamSide === "one" ? match.team_one_id : match.team_two_id);
}

export function getTeamName(match, teamSide) {
	if (teamSide === "one") {
		return match.team_one?.team || match.team_one_name || "Unknown Team";
	}
	return match.team_two?.team || match.team_two_name || "Unknown Team";
}

export function getBasketballActivePeriod(match) {
	return Math.min(getScoreSheetPeriodLimit(match), Math.max(1, Number(match?.game_period) || 1));
}

export function getBasketballStatsForMatch(matchId) {
	return state.basketballStatsByMatch.get(Number(matchId)) || [];
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

function getStudentBasketballTeamRows(match, teamSide, activeOnly = false) {
	const teamId = getTeamId(match, teamSide);
	const activePeriod = getBasketballActivePeriod(match);
	const allTeamRows = getSafeBasketballStatRows(getBasketballStatsForMatch(match.id))
		.filter(row => Number(row.team_id) === Number(teamId));
	return allTeamRows
		.filter(row => Number(row.game_period || 1) === activePeriod)
		.filter(row => !activeOnly || row.is_active)
		.map(row => {
			const key = normalizeTeamValue(row.id_number || row.participant_id);
			const cumulativeRows = allTeamRows.filter(teamRow =>
				normalizeTeamValue(teamRow.id_number || teamRow.participant_id) === key
			);
			return {
				...row,
				points: cumulativeRows.reduce((total, teamRow) => total + (Number(teamRow.points) || 0), 0),
				fouls: cumulativeRows.reduce((total, teamRow) => total + (Number(teamRow.fouls) || 0), 0)
			};
		})
		.sort((first, second) => {
			const firstActive = first.is_active ? 1 : 0;
			const secondActive = second.is_active ? 1 : 0;
			if (firstActive !== secondActive) return secondActive - firstActive;
			const firstTime = new Date(first.created_at || 0).getTime();
			const secondTime = new Date(second.created_at || 0).getTime();
			return firstTime - secondTime;
		});
}

function getStudentBasketballTotals(match, teamSide, gamePeriod = null) {
	const teamId = getTeamId(match, teamSide);
	return getSafeBasketballStatRows(getBasketballStatsForMatch(match.id))
		.filter(row => Number(row.team_id) === Number(teamId))
		.filter(row => gamePeriod === null || Number(row.game_period || 1) === Number(gamePeriod))
		.reduce((totals, row) => {
			totals.points += Number(row.points) || 0;
			totals.fouls += Number(row.fouls) || 0;
			return totals;
		}, { points: 0, fouls: 0 });
}

export function renderStudentBasketballScoreSheet(match, options = {}) {
	if (!hasPlayerScoreSheet(match) || match.status !== "Ongoing") {
		return "";
	}
	const { compact = false } = options;
	const isVolleyballMatch = isVolleyballSport(match);
	const faultLabel = getScoreSheetFaultLabel(match);
	const periodName = isVolleyballMatch ? "set" : "quarter";
	const scoreSheetTitle = isVolleyballMatch ? "Volleyball Score Sheet Preview" : "Basketball Score Sheet Preview";
	const teamOneGameTotals = getStudentBasketballTotals(match, "one");
	const teamTwoGameTotals = getStudentBasketballTotals(match, "two");
	const renderTeamPreview = (teamSide, theme) => {
		const teamName = getTeamName(match, teamSide);
		const rows = getStudentBasketballTeamRows(match, teamSide, true);
		const gameTotals = teamSide === "one" ? teamOneGameTotals : teamTwoGameTotals;
		const visibleRows = rows.length ? rows : [];
		return `
		<div class="student-basketball-score-team rounded-2xl border ${theme.border} ${theme.bg} overflow-hidden">
		<div class="flex items-center justify-between gap-1 px-2 py-2 sm:gap-2 sm:px-3">
		<div class="min-w-0">
		<h4 class="truncate text-[11px] font-black uppercase ${theme.text} sm:text-sm">${escapeHTML(teamName)}</h4>
		</div>
		<div class="shrink-0 text-right">
		<p class="text-lg font-black leading-none ${theme.text} sm:text-2xl">${gameTotals.points}</p>
		</div>
		</div>
		<div class="max-h-44 overflow-y-auto border-t ${theme.border}">
		<table class="student-basketball-score-table w-full table-fixed text-[10px] sm:text-xs">
		<thead class="${theme.header}">
		<tr>
		<th class="w-6 py-1.5 text-left sm:w-8 sm:py-2">#</th>
		<th class="py-1.5 text-left sm:py-2">Player</th>
		<th class="w-10 whitespace-nowrap py-1.5 text-center sm:w-12 sm:py-2">PTS</th>
		<th class="w-10 whitespace-nowrap py-1.5 text-center sm:w-12 sm:py-2">${faultLabel}</th>
		</tr>
		</thead>
		<tbody>
		${visibleRows.length ? visibleRows.map((row, index) => `
		<tr class="border-t border-white/70 bg-white/75">
		<td class="py-1.5 font-black sm:py-2">${index + 1}</td>
		<td class="student-basketball-score-player truncate py-1.5 font-bold text-slate-800 sm:py-2">${escapeHTML(row.player_name || row.id_number || "Player")}</td>
		<td class="py-1.5 text-center font-black ${theme.text} sm:py-2">${Number(row.points) || 0}</td>
		<td class="py-1.5 text-center font-black text-red-600 sm:py-2">${Number(row.fouls) || 0}</td>
		</tr>
		`).join("") : `
		<tr>
		<td colspan="4" class="px-3 py-4 text-center text-[11px] font-semibold text-slate-500">
		No active players selected for this ${periodName} yet.
		</td>
		</tr>
		`}
		</tbody>
		</table>
		</div>
		</div>
		`;
	};
	return `
	<div class="student-basketball-score-preview ${compact ? "mt-4" : ""} rounded-2xl border border-slate-200 bg-white/85 p-3 shadow-sm">
	<div class="mb-3">
	<div>
	<p class="text-[10px] font-black uppercase tracking-widest text-slate-500">${scoreSheetTitle}</p>
	</div>
	</div>
	<div class="student-basketball-score-grid grid gap-2 sm:gap-3">
	${renderTeamPreview("one", {
		border: "border-blue-200",
		bg: "bg-blue-50/70",
		header: "bg-blue-100 text-blue-900",
		label: "text-blue-600",
		text: "text-blue-700"
	})}
	${renderTeamPreview("two", {
		border: "border-emerald-200",
		bg: "bg-emerald-50/70",
		header: "bg-emerald-100 text-emerald-900",
		label: "text-emerald-600",
		text: "text-emerald-700"
	})}
	</div>
	</div>
	`;
}
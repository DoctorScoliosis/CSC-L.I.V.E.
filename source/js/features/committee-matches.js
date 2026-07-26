/*
 * Match management for the Committee dashboard.
 *
 * Owns the full match lifecycle that a committee member controls:
 *   - scheduling matches (restricted to the account's assigned sport)
 *   - the Next -> Ongoing -> Done flow, with pre-game timers
 *   - the editable basketball / volleyball score sheet (lineup, active
 *     players, points, fouls, quarters/sets)
 *   - declaring a winner + merit/demerit adjustments before marking Done
 *   - the "My Matches / All Matches" scope and sport filters
 *   - requesting admin approval to delete a match
 *
 * Reads the signed-in user and shared data through committee-context.js.
 * Admins get full access; committee members only manage matches they
 * created (enforced both in the UI and with ownership-filtered queries).
 */

import {
	supabase,
	state,
	dom,
	TEAMS_TABLE,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	PARTICIPANTS_TABLE,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME,
	MATCH_PERMISSION_MESSAGE,
	COMMITTEE_MATCH_STATUS_TAB_KEY,
	COMMITTEE_MATCH_SCOPE_KEY,
	isCurrentUserAdmin,
	isMatchOwner,
	canManageMatch,
	getCurrentUserCreatorKey,
	getCurrentUserCreatorKeys,
	getCurrentUserDisplayName
} from "../pages/committee-context.js";
import { escapeHTML } from "../utils/dom.js";
import {
	formatDateTimeShort as formatDateTime,
	formatDateTimeLocalInput as formatForDateTimeLocal,
	clampTimerSeconds,
	formatTimerDisplay,
	calculateRemainingSeconds
} from "../utils/datetime.js";
import { normalizeComparableValue } from "../utils/normalize.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";

// --- Placement of match controls (header vs inline) --------------------------
export function placeMatchControlsForTab(tabName) {
	if (!dom.matchHeaderControls || !dom.matchControlsHome || !dom.matchPrimaryControls) {
		return;
	}
	const isMatchesTab = tabName === "matches";
	const shouldUseHeaderControls = isMatchesTab && window.innerWidth >= 1024;
	if (shouldUseHeaderControls) {
		if (dom.matchPrimaryControls.parentElement !== dom.matchHeaderControls) {
			dom.matchHeaderControls.appendChild(dom.matchPrimaryControls);
		}
		dom.matchHeaderControls.classList.add("is-active");
		dom.matchControlsHome.classList.add("match-controls-home-collapsed");
	} else {
		if (dom.matchPrimaryControls.parentElement !== dom.matchControlsHome) {
			dom.matchControlsHome.insertBefore(dom.matchPrimaryControls, dom.matchControlsHome.firstChild);
		}
		dom.matchHeaderControls.classList.remove("is-active");
		dom.matchControlsHome.classList.toggle("match-controls-home-collapsed", isMatchesTab);
	}
}

export function revealPlacedMatchControls() {
	document.body.classList.remove("match-controls-pending");
}

// --- Ownership / permission enforcement --------------------------------------
function showPermissionDenied() {
	alert(MATCH_PERMISSION_MESSAGE);
}

export function enforceMatchPermission(match) {
	if (canManageMatch(match)) {
		return true;
	}
	showPermissionDenied();
	return false;
}

function applyOwnershipFilter(query) {
	if (isCurrentUserAdmin()) {
		return query;
	}
	const creatorKeys = getCurrentUserCreatorKeys();
	if (creatorKeys.length === 0) {
		return query.eq("created_by", "__missing_logged_in_user__");
	}
	return query.in("created_by", creatorKeys);
}

async function updateMatchRecord(matchId, updatePayload, options = {}) {
	let query = supabase
		.from(MATCHES_TABLE)
		.update(updatePayload)
		.eq("id", matchId);
	if (options.status) {
		query = query.eq("status", options.status);
	}
	query = applyOwnershipFilter(query);
	const { data, error } = await query
		.select("id")
		.maybeSingle();
	if (error) {
		throw error;
	}
	if (!data) {
		throw new Error(MATCH_PERMISSION_MESSAGE);
	}
	return data;
}

async function requestMatchDeleteApproval(match) {
	const requestPayload = {
		delete_requested: true,
		delete_requested_at: new Date().toISOString(),
		delete_requested_by: getCurrentUserCreatorKey(),
		delete_requested_by_name: state.currentUser?.fullName || state.currentUser?.email || "Committee",
		delete_approved: false,
		delete_rejected: false,
		delete_rejected_at: null,
		delete_rejected_by: null
	};
	return updateMatchRecord(match.id, requestPayload);
}

function getRoleLabel(roleValue) {
	const normalizedRole = normalizeComparableValue(roleValue);
	if (normalizedRole === "admin") {
		return "Admin";
	}
	if (normalizedRole === "committee") {
		return "Committee";
	}
	return roleValue || "Unknown Role";
}

function buildMatchOwnerLine(match, canManage) {
	const creatorName = match.created_by_name || match.created_by || "Unassigned match";
	const creatorRole = match.created_by_role ? ` • ${getRoleLabel(match.created_by_role)}` : "";
	const accessText = isCurrentUserAdmin()
		? "Admin full access"
		: canManage
		? "You created this match"
		: "View only";
	return `${escapeHTML(creatorName)}${escapeHTML(creatorRole)} • ${escapeHTML(accessText)}`;
}

// --- Match / sport helpers ---------------------------------------------------
export function getTeamName(match, teamSide) {
	if (teamSide === "one") {
		return match.team_one?.team || match.team_one_name || "Unknown Team";
	}
	return match.team_two?.team || match.team_two_name || "Unknown Team";
}

export function getTeamId(match, teamSide) {
	return teamSide === "one"
		? Number(match.team_one_id)
		: Number(match.team_two_id);
}

export function getSportName(match) {
	return match.sport?.sport_name || match.sport_name || "Unknown Sport";
}

function normalizeSportName(value) {
	return String(value || "").trim().toLowerCase();
}

function isBasketballSport(matchOrName) {
	const sportName = typeof matchOrName === "string" ? matchOrName : getSportName(matchOrName);
	return normalizeSportName(sportName).includes("basketball");
}

function isVolleyballSport(matchOrName) {
	const sportName = typeof matchOrName === "string" ? matchOrName : getSportName(matchOrName);
	return normalizeSportName(sportName).includes("volleyball");
}

function hasPlayerScoreSheet(matchOrName) {
	return isBasketballSport(matchOrName) || isVolleyballSport(matchOrName);
}

function getScoreSheetPeriodLimit(matchOrName) {
	return isVolleyballSport(matchOrName) ? 5 : 4;
}

function getScoreSheetPeriodLabel(matchOrName) {
	return isVolleyballSport(matchOrName) ? "Set" : "Quarter";
}

function getScoreSheetFaultLabel(matchOrName) {
	return isVolleyballSport(matchOrName) ? "FLT" : "FLS";
}

function getMatchStageLabel(stage) {
	if (!String(stage || "").trim()) {
		return "Elimination Round";
	}
	return {
		regular: "Elimination Round",
		semifinals: "Semifinals",
		finals: "Finals",
		battle_for_third: "Battle for Third"
	}[stage] || "";
}

function normalizeTeamValue(value) {
	return String(value || "").trim().toLowerCase();
}

function getParticipantDisplayName(participant) {
	return participant?.name
		|| participant?.full_name
		|| participant?.participant_name
		|| participant?.student_name
		|| "";
}

// --- Basketball score sheet data ---------------------------------------------
function getBasketballStatsForMatch(matchId) {
	return state.basketballStatsByMatch.get(Number(matchId)) || [];
}

function getBasketballActivePeriod(match) {
	return Math.min(getScoreSheetPeriodLimit(match), Math.max(1, Number(match?.game_period) || 1));
}

function getSafeBasketballStatRows(rows) {
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

function sortBasketballLineupRows(rows) {
	return [...rows].sort((first, second) => {
		const firstTime = new Date(first.created_at || 0).getTime();
		const secondTime = new Date(second.created_at || 0).getTime();
		if (firstTime !== secondTime) return firstTime - secondTime;
		return String(first.id || "").localeCompare(String(second.id || ""));
	});
}

function getBasketballLineupRows(match, teamSide) {
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

function getBasketballDisplayRows(match, teamSide) {
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

function getBasketballTotals(match, teamSide, gamePeriod = null) {
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

// --- Basketball score sheet rendering ----------------------------------------
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

function renderBasketballScoreSheet(match, canManageCurrentMatch) {
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

// --- Basketball player / stat persistence ------------------------------------
async function findParticipantByIdNumber(idNumber) {
	const safeId = String(idNumber || "").trim();
	if (!safeId) return null;
	const { data, error } = await supabase
		.from(PARTICIPANTS_TABLE)
		.select("*")
		.or(`student_id.eq.${safeId},id_number.eq.${safeId}`)
		.limit(1);
	if (error) {
		console.warn("Participant lookup failed:", error.message || error);
		return null;
	}
	return Array.isArray(data) && data.length ? data[0] : null;
}

async function saveBasketballRosterPlayer({ matchId, teamId, payload, lineupStatId, previousIdNumber }) {
	const allRows = getBasketballStatsForMatch(matchId)
		.filter(row => Number(row.team_id) === Number(teamId));
	const normalizedNewId = normalizeTeamValue(payload.id_number);
	const normalizedPreviousId = normalizeTeamValue(previousIdNumber);
	const quarterOneRows = allRows.filter(row => Number(row.game_period || 1) === 1);
	const rowByNewId = quarterOneRows.find(row => normalizeTeamValue(row.id_number) === normalizedNewId);
	const rowByPreviousId = normalizedPreviousId
		? quarterOneRows.find(row => normalizeTeamValue(row.id_number) === normalizedPreviousId)
		: null;
	const rowByLineupId = lineupStatId
		? quarterOneRows.find(row => String(row.id) === String(lineupStatId))
		: null;
	const targetRow = rowByNewId || rowByLineupId || rowByPreviousId;
	if (rowByNewId && rowByPreviousId && String(rowByNewId.id) !== String(rowByPreviousId.id)) {
		const { error: deleteError } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.delete()
			.eq("id", rowByPreviousId.id);
		if (deleteError) return deleteError;
	}
	if (targetRow) {
		const { error } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.update({
				...payload,
				game_period: 1
			})
			.eq("id", targetRow.id);
		if (error) return error;
	} else {
		const { error } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.insert([{
				...payload,
				game_period: 1,
				points: 0,
				fouls: 0,
				is_active: false
			}]);
		if (error) return error;
	}
	const rowsToSync = allRows.filter(row => {
		const rowIdNumber = normalizeTeamValue(row.id_number);
		return rowIdNumber === normalizedNewId || (normalizedPreviousId && rowIdNumber === normalizedPreviousId);
	});
	for (const row of rowsToSync) {
		if (Number(row.game_period || 1) === 1) continue;
		const { error } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.update({
				participant_id: payload.participant_id,
				id_number: payload.id_number,
				player_name: payload.player_name,
				updated_at: new Date().toISOString()
			})
			.eq("id", row.id);
		if (error) return error;
	}
	return null;
}

async function saveBasketballPlayerFromInput(input) {
	const idNumber = String(input.value || "").trim();
	if (!idNumber) return;
	if (input.dataset.saving === "true") return;
	const matchId = Number(input.dataset.matchId);
	const teamId = Number(input.dataset.teamId);
	const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
	if (!selectedMatch || !enforceMatchPermission(selectedMatch)) return;
	const gamePeriod = Math.min(
		getScoreSheetPeriodLimit(selectedMatch),
		Math.max(1, Number(input.dataset.gamePeriod) || getBasketballActivePeriod(selectedMatch))
	);
	const teamSide = input.dataset.teamSide;
	const teamName = getTeamName(selectedMatch, teamSide);
	if ((input.dataset.statId || input.dataset.lineupStatId) && idNumber === String(input.dataset.idNumber || "").trim()) {
		input.dataset.editingId = "false";
		input.readOnly = true;
		input.value = input.dataset.playerName || input.dataset.idNumber || idNumber;
		return;
	}
	input.dataset.saving = "true";
	const participant = await findParticipantByIdNumber(idNumber);
	const participantTeam = participant?.team || participant?.team_name || "";
	if (!participant) {
		alert(`ID Number ${idNumber} is not registered. Please enter a registered participant ID.`);
		input.value = "";
		input.dataset.saving = "false";
		return;
	} else if (normalizeTeamValue(participantTeam) !== normalizeTeamValue(teamName)) {
		alert(`${getParticipantDisplayName(participant) || idNumber} is registered under ${participantTeam || "another team"}, not ${teamName}. This player cannot be added to this team.`);
		input.value = "";
		input.dataset.saving = "false";
		return;
	}
	const existingOtherTeamRow = getBasketballStatsForMatch(matchId)
		.find(row =>
			Number(row.team_id) !== Number(teamId)
			&& normalizeTeamValue(row.id_number) === normalizeTeamValue(idNumber)
		);
	if (existingOtherTeamRow) {
		alert(`${getParticipantDisplayName(participant) || idNumber} is already listed under ${existingOtherTeamRow.team_name || "the other team"} for this match.`);
		input.value = "";
		input.dataset.saving = "false";
		return;
	}
	const payload = {
		match_id: matchId,
		team_id: teamId,
		team_name: teamName,
		participant_id: participant?.id || null,
		id_number: idNumber,
		player_name: getParticipantDisplayName(participant) || idNumber,
		updated_at: new Date().toISOString()
	};
	const saveError = await saveBasketballRosterPlayer({
		matchId,
		teamId,
		payload,
		lineupStatId: input.dataset.lineupStatId || input.dataset.statId || "",
		previousIdNumber: input.dataset.idNumber || ""
	});
	if (saveError) {
		console.error("Basketball player save error:", saveError.message || saveError);
		alert("Unable to save basketball player. Run the basketball score SQL first.");
		input.dataset.saving = "false";
		return;
	}
	await consolidateBasketballDuplicateRows(matchId);
	await loadSavedMatches();
	input.dataset.saving = "false";
}

async function consolidateBasketballDuplicateRows(matchId) {
	const safeMatchId = Number(matchId);
	if (!safeMatchId) return;
	const { data, error } = await supabase
		.from(BASKETBALL_STATS_TABLE)
		.select("*")
		.eq("match_id", safeMatchId);
	if (error || !Array.isArray(data)) {
		if (error) console.warn("Basketball duplicate check warning:", error.message || error);
		return;
	}
	const groups = new Map();
	data.forEach(row => {
		const rowKeyValue = String(row.id_number || row.participant_id || "").trim();
		if (!rowKeyValue) return;
		const key = `${row.match_id}:${row.team_id}:${Number(row.game_period || 1)}:${rowKeyValue.toLowerCase()}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	});
	for (const groupRows of groups.values()) {
		if (groupRows.length < 2) continue;
		const sortedRows = [...groupRows].sort((first, second) => {
			const firstTime = new Date(first.created_at || 0).getTime();
			const secondTime = new Date(second.created_at || 0).getTime();
			if (firstTime !== secondTime) return firstTime - secondTime;
			return Number(first.id) - Number(second.id);
		});
		const primary = sortedRows[0];
		const duplicateIds = sortedRows.slice(1).map(row => row.id).filter(Boolean);
		const latestNamedRow = [...sortedRows].reverse().find(row => row.player_name || row.id_number) || primary;
		const mergedPoints = Math.max(...sortedRows.map(row => Number(row.points) || 0));
		const mergedFouls = Math.max(...sortedRows.map(row => Number(row.fouls) || 0));
		const { error: updateError } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.update({
				points: mergedPoints,
				fouls: mergedFouls,
				participant_id: latestNamedRow.participant_id || primary.participant_id || null,
				id_number: latestNamedRow.id_number || primary.id_number,
				player_name: latestNamedRow.player_name || primary.player_name || primary.id_number,
				updated_at: new Date().toISOString()
			})
			.eq("id", primary.id);
		if (updateError) {
			console.warn("Basketball duplicate merge warning:", updateError.message || updateError);
			continue;
		}
		if (duplicateIds.length > 0) {
			const { error: deleteError } = await supabase
				.from(BASKETBALL_STATS_TABLE)
				.delete()
				.in("id", duplicateIds);
			if (deleteError) {
				console.warn("Basketball duplicate delete warning:", deleteError.message || deleteError);
			}
		}
	}
}

// --- Basketball points modal + stat updates ----------------------------------
function openBasketballPointModal(button) {
	const selectedMatch = state.matchesData.find(match => Number(match.id) === Number(button.dataset.matchId));
	const periodLimit = getScoreSheetPeriodLimit(selectedMatch || "");
	state.pendingBasketballPointTarget = {
		matchId: Number(button.dataset.matchId),
		teamId: Number(button.dataset.teamId) || null,
		gamePeriod: Math.min(periodLimit, Math.max(1, Number(button.dataset.gamePeriod) || 1)),
		statId: button.dataset.statId || "",
		lineupStatId: button.dataset.lineupStatId || "",
		idNumber: button.dataset.idNumber || ""
	};
	const row = Array.from(state.basketballStatsByMatch.values())
		.flat()
		.find(item =>
			String(item.id) === String(state.pendingBasketballPointTarget.statId)
			|| String(item.id) === String(state.pendingBasketballPointTarget.lineupStatId)
		);
	if (dom.basketballPointModalTitle) {
		dom.basketballPointModalTitle.textContent = isVolleyballSport(selectedMatch || "") ? "Add Volleyball Points" : "Add Basketball Points";
	}
	dom.basketballPointPlayerLabel.textContent = row?.player_name || row?.id_number || "Selected player";
	dom.basketballPointModal.classList.remove("hidden");
	dom.basketballPointModal.classList.add("flex");
}

export function closeBasketballPointModalFunction() {
	state.pendingBasketballPointTarget = null;
	dom.basketballPointModal.classList.add("hidden");
	dom.basketballPointModal.classList.remove("flex");
}

async function ensureBasketballPeriodStatRow(statId, options = {}) {
	let statRow = Array.from(state.basketballStatsByMatch.values())
		.flat()
		.find(row => String(row.id) === String(statId));
	if (statRow) return statRow;
	const lineupRow = Array.from(state.basketballStatsByMatch.values())
		.flat()
		.find(row =>
			String(row.id) === String(options.lineupStatId || "")
			|| (
				Number(row.match_id) === Number(options.matchId)
				&& Number(row.team_id) === Number(options.teamId)
				&& normalizeTeamValue(row.id_number || row.participant_id) === normalizeTeamValue(options.idNumber)
			)
		);
	if (!lineupRow) return null;
	const targetMatchId = Number(options.matchId) || lineupRow.match_id;
	const targetTeamId = Number(options.teamId) || lineupRow.team_id;
	const selectedMatch = state.matchesData.find(match => Number(match.id) === Number(targetMatchId));
	const targetPeriod = Math.min(getScoreSheetPeriodLimit(selectedMatch || ""), Math.max(1, Number(options.gamePeriod) || 1));
	const lineupKey = normalizeTeamValue(lineupRow.id_number || lineupRow.participant_id);
	const periodRow = Array.from(state.basketballStatsByMatch.values())
		.flat()
		.find(row =>
			Number(row.match_id) === Number(targetMatchId)
			&& Number(row.team_id) === Number(targetTeamId)
			&& Number(row.game_period || 1) === Number(targetPeriod)
			&& normalizeTeamValue(row.id_number || row.participant_id) === lineupKey
		);
	if (periodRow) return periodRow;
	const { data: insertedRow, error: insertError } = await supabase
		.from(BASKETBALL_STATS_TABLE)
		.upsert({
			match_id: targetMatchId,
			team_id: targetTeamId,
			team_name: lineupRow.team_name,
			game_period: targetPeriod,
			participant_id: lineupRow.participant_id || null,
			id_number: lineupRow.id_number,
			player_name: lineupRow.player_name || lineupRow.id_number,
			updated_at: new Date().toISOString()
		}, {
			onConflict: "match_id,team_id,game_period,id_number"
		})
		.select("*")
		.single();
	if (insertError) {
		console.error("Basketball period stat insert error:", insertError.message || insertError);
		return null;
	}
	return insertedRow;
}

async function addBasketballStatValue(statId, field, amount, options = {}) {
	const statRow = await ensureBasketballPeriodStatRow(statId, options);
	if (!statRow) {
		alert("Please type and save the player ID first.");
		return;
	}
	if (Number(amount) > 0 && !statRow.is_active) {
		const selectedMatch = state.matchesData.find(match => Number(match.id) === Number(statRow.match_id || options.matchId));
		alert(`Select this player as active in the current ${getScoreSheetPeriodLabel(selectedMatch || "").toLowerCase()} before adding points or ${getScoreSheetFaultLabel(selectedMatch || "").toLowerCase()}.`);
		return;
	}
	const nextValue = Math.max(0, (Number(statRow[field]) || 0) + amount);
	const { error } = await supabase
		.from(BASKETBALL_STATS_TABLE)
		.update({
			[field]: nextValue,
			updated_at: new Date().toISOString()
		})
		.eq("id", statRow.id);
	if (error) {
		console.error("Basketball stat update error:", error.message || error);
		alert("Unable to update basketball stat. Run the basketball score SQL first.");
		return;
	}
	await consolidateBasketballDuplicateRows(statRow.match_id);
	await loadSavedMatches();
}

async function toggleBasketballActivePlayer(statId, nextActive, options = {}) {
	let statRow = Array.from(state.basketballStatsByMatch.values())
		.flat()
		.find(row => String(row.id) === String(statId));
	if (!statRow) {
		const lineupRow = Array.from(state.basketballStatsByMatch.values())
			.flat()
			.find(row => String(row.id) === String(options.lineupStatId || ""));
		if (!lineupRow) {
			alert("Please type and save the player ID first.");
			return;
		}
		const selectedMatch = state.matchesData.find(match => Number(match.id) === Number(options.matchId || lineupRow.match_id));
		const { data: insertedRows, error: insertError } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.upsert({
				match_id: Number(options.matchId) || lineupRow.match_id,
				team_id: Number(options.teamId) || lineupRow.team_id,
				team_name: lineupRow.team_name,
				game_period: Math.min(getScoreSheetPeriodLimit(selectedMatch || ""), Math.max(1, Number(options.gamePeriod) || 1)),
				participant_id: lineupRow.participant_id || null,
				id_number: lineupRow.id_number,
				player_name: lineupRow.player_name || lineupRow.id_number,
				is_active: Boolean(nextActive),
				updated_at: new Date().toISOString()
			}, {
				onConflict: "match_id,team_id,game_period,id_number"
			})
			.select("*")
			.single();
		if (insertError) {
			console.error("Basketball active player insert error:", insertError.message || insertError);
			alert("Unable to update active player. Run the basketball score SQL first.");
			return;
		}
		statRow = insertedRows;
	}
	const { error } = await supabase
		.from(BASKETBALL_STATS_TABLE)
		.update({
			is_active: Boolean(nextActive),
			updated_at: new Date().toISOString()
		})
		.eq("id", statRow.id);
	if (error) {
		console.error("Basketball active player update error:", error.message || error);
		alert("Unable to update active player. Run the basketball score SQL first.");
		return;
	}
	await loadSavedMatches();
}

// --- Sport assignment / scheduling permissions -------------------------------
function normalizeSportText(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeSportCompact(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

function canCurrentUserScheduleAllSports() {
	return isCurrentUserAdmin()
		|| state.currentUser?.assignedSportId === OVERALL_COMMITTEE_SPORT_ID
		|| normalizeSportText(state.currentUser?.assignedSportName) === normalizeSportText(OVERALL_COMMITTEE_SPORT_NAME);
}

function isSportVisibleForCurrentUser(sport) {
	if (canCurrentUserScheduleAllSports()) {
		return true;
	}
	const assignedSportId = String(state.currentUser?.assignedSportId || "").trim();
	const assignedSportName = normalizeSportText(state.currentUser?.assignedSportName);
	const assignedSportCompact = normalizeSportCompact(state.currentUser?.assignedSportName);
	const sportId = String(sport?.id || "").trim();
	const sportName = normalizeSportText(sport?.sport_name || sport?.name || "");
	const sportCompact = normalizeSportCompact(sport?.sport_name || sport?.name || "");
	if (assignedSportId && sportId && assignedSportId === sportId) {
		return true;
	}
	if ((!assignedSportName || !sportName) && (!assignedSportCompact || !sportCompact)) {
		return false;
	}
	return sportName.includes(assignedSportName)
		|| assignedSportName.includes(sportName)
		|| sportCompact.includes(assignedSportCompact)
		|| assignedSportCompact.includes(sportCompact);
}

export function canCurrentUserUseMatchViewFilters() {
	return state.currentUser?.assignedSportId === OVERALL_COMMITTEE_SPORT_ID
		|| normalizeSportText(state.currentUser?.assignedSportName) === normalizeSportText(OVERALL_COMMITTEE_SPORT_NAME);
}

// --- Loading -----------------------------------------------------------------
export async function loadSportsForMatches() {
	const { data, error } = await supabase
		.from(SPORTS_TABLE)
		.select("id, sport_name")
		.order("sport_name", { ascending: true });
	dom.matchSport.innerHTML = `<option value="">Select sport or game category</option>`;
	if (error) {
		console.error("Error loading sports:", error.message || error);
		dom.matchSport.innerHTML = `<option value="">Failed to load sports</option>`;
		populateSportFilterOptions([]);
		alert("Failed to load registered sports from the database.");
		return;
	}
	const allSports = data || [];
	const visibleSports = allSports.filter(isSportVisibleForCurrentUser);
	populateSportFilterOptions(allSports);
	if (allSports.length === 0) {
		dom.matchSport.innerHTML = `<option value="">No registered sports found</option>`;
		return;
	}
	if (visibleSports.length === 0) {
		dom.matchSport.innerHTML = `<option value="">No sports available for your account assignment</option>`;
		return;
	}
	visibleSports.forEach(sport => {
		const option = document.createElement("option");
		option.value = sport.id;
		option.textContent = sport.sport_name;
		dom.matchSport.appendChild(option);
	});
}

export async function loadRegisteredTeams() {
	const { data, error } = await supabase
		.from(TEAMS_TABLE)
		.select("id, team")
		.order("team", { ascending: true });
	if (error) {
		console.error("Error loading teams:", error.message || error);
		alert("Error loading registered teams from sports_leaderboard.");
		return;
	}
	dom.teamOne.innerHTML = `<option value="">Select first team</option>`;
	dom.teamTwo.innerHTML = `<option value="">Select second team</option>`;
	(data || []).forEach(item => {
		const optionOne = document.createElement("option");
		optionOne.value = item.id;
		optionOne.textContent = item.team;
		const optionTwo = document.createElement("option");
		optionTwo.value = item.id;
		optionTwo.textContent = item.team;
		dom.teamOne.appendChild(optionOne);
		dom.teamTwo.appendChild(optionTwo);
	});
}

export async function loadSavedMatches() {
	const { data, error } = await supabase
		.from(MATCHES_TABLE)
		.select(`
		id,
		sport_id,
		team_one_id,
		team_two_id,
		match_time,
		location,
		status,
		delete_requested,
		delete_requested_at,
		delete_requested_by,
		delete_requested_by_name,
		delete_approved,
		delete_approved_at,
		delete_rejected,
		delete_rejected_at,
		timer_enabled,
		timer_duration_seconds,
		timer_started_at,
		match_stage,
		game_period,
		created_by,
		created_by_role,
		created_by_name,
		sport:sports!scheduled_matches_sport_id_fkey(id, sport_name),
		team_one:sports_leaderboard!scheduled_matches_team_one_fkey(team),
		team_two:sports_leaderboard!scheduled_matches_team_two_fkey(team)
		`)
		.order("match_time", { ascending: true });
	if (error) {
		console.error("Error loading saved matches:", error.message || error);
		return;
	}
	state.matchesData = data || [];
	const matchIds = state.matchesData.map(match => match.id);
	state.basketballStatsByMatch = new Map();
	if (matchIds.length > 0) {
		const { data: historyRows, error: historyError } = await supabase
			.from(GAME_HISTORY_TABLE)
			.select("*")
			.in("match_id", matchIds);
		if (!historyError && Array.isArray(historyRows)) {
			const historyMap = new Map();
			historyRows.forEach(history => {
				historyMap.set(Number(history.match_id), history);
			});
			state.matchesData = state.matchesData.map(match => ({
				...match,
				game_history: historyMap.get(Number(match.id)) || null
			}));
		}
		const { data: basketballRows, error: basketballError } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.select("*")
			.in("match_id", matchIds);
		if (basketballError) {
			console.warn("Basketball score sheet load warning:", basketballError.message || basketballError);
		} else if (Array.isArray(basketballRows)) {
			basketballRows.forEach(row => {
				const key = Number(row.match_id);
				if (!state.basketballStatsByMatch.has(key)) {
					state.basketballStatsByMatch.set(key, []);
				}
				state.basketballStatsByMatch.get(key).push(row);
			});
		}
	}
	renderMatches(state.matchesData);
}

// --- Filtering + rendering ---------------------------------------------------
function sortMatchesWithOwnFirst(matches) {
	return [...matches].sort((firstMatch, secondMatch) => {
		const firstIsOwn = isMatchOwner(firstMatch) ? 1 : 0;
		const secondIsOwn = isMatchOwner(secondMatch) ? 1 : 0;
		if (firstIsOwn !== secondIsOwn) {
			return secondIsOwn - firstIsOwn;
		}
		const firstTime = new Date(firstMatch.match_time || 0).getTime() || 0;
		const secondTime = new Date(secondMatch.match_time || 0).getTime() || 0;
		return firstTime - secondTime;
	});
}

function getFilteredMatchesForDisplay(matches) {
	let filteredMatches = Array.isArray(matches) ? [...matches] : [];
	if (canCurrentUserUseMatchViewFilters() && state.activeSportFilterId) {
		filteredMatches = filteredMatches.filter(match => String(match.sport_id) === String(state.activeSportFilterId));
	}
	if (state.activeMatchScopeFilter === "mine") {
		filteredMatches = filteredMatches.filter(match => isMatchOwner(match));
	}
	return sortMatchesWithOwnFirst(filteredMatches);
}

function getLocalDateInputValue(dateValue) {
	if (!dateValue) return "";
	const date = new Date(dateValue);
	if (Number.isNaN(date.getTime())) return "";
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function getMatchDateValue(match) {
	return getLocalDateInputValue(match?.match_time);
}

export function renderMatches(matches) {
	const visibleMatches = getFilteredMatchesForDisplay(matches);
	const nextMatches = visibleMatches.filter(match => {
		if (match.status !== "Next") return false;
		if (!state.activeDoneMatchesDate) return true;
		return getMatchDateValue(match) === state.activeDoneMatchesDate;
	});
	const ongoingMatches = visibleMatches.filter(match => match.status === "Ongoing");
	const doneMatches = visibleMatches.filter(match => {
		if (match.status !== "Done") return false;
		if (!state.activeDoneMatchesDate) return true;
		return getMatchDateValue(match) === state.activeDoneMatchesDate;
	});
	renderMatchesIntoGrid(dom.nextMatchesGrid, nextMatches, "Next");
	renderMatchesIntoGrid(dom.ongoingMatchesGrid, ongoingMatches, "Ongoing");
	renderMatchesIntoGrid(dom.doneMatchesGrid, doneMatches, "Done");
	addStatusListeners();
	addGamePeriodListeners();
	addBasketballScoreListeners();
	addTimerListeners();
	addTimerControlListeners();
	addEditMatchListeners();
	addDeleteMatchListeners();
	setActiveStatusTab(state.activeStatusTab);
}

function renderMatchesIntoGrid(gridElement, matches, statusLabel) {
	gridElement.innerHTML = "";
	const isOngoingGrid = statusLabel === "Ongoing";
	gridElement.className = isOngoingGrid
		? "grid grid-cols-1 gap-6 justify-items-center"
		: "grid grid-cols-1 md:grid-cols-2 gap-6";
	if (matches.length === 0) {
		gridElement.innerHTML = `
		<div class="col-span-full p-6 bg-white border-0 shadow-md rounded-lg">
		<p class="text-gray-600">No ${statusLabel === "Ongoing" ? "On Going" : statusLabel} matches for the selected filters.</p>
		</div>
		`;
		return;
	}
	matches.forEach(match => {
		const firstTeamName = getTeamName(match, "one");
		const secondTeamName = getTeamName(match, "two");
		const history = match.game_history;
		const isDone = match.status === "Done";
		const isOngoing = match.status === "Ongoing";
		const isNext = match.status === "Next";
		const duration = clampTimerSeconds(match.timer_duration_seconds) || 600;
		const durationParts = splitTimerDuration(duration);
		const remainingSeconds = calculateRemainingSeconds(match);
		const canManageCurrentMatch = canManageMatch(match);
		const lockedControlClasses = "bg-gray-300 hover:bg-gray-300 text-gray-500 cursor-not-allowed";
		const timerFieldState = canManageCurrentMatch ? "" : "disabled";
		const ownerLine = buildMatchOwnerLine(match, canManageCurrentMatch);
		const deleteRequestNotice = match.delete_requested ? `
		<div class="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
		Delete request pending admin approval${match.delete_requested_by_name ? ` by ${escapeHTML(match.delete_requested_by_name)}` : ""}.
		</div>
		` : "";
		const resultText = history?.result
			|| (history
				? `${history.winner_team_name || "Winner"} won against ${history.loser_team_name || "Loser"}`
				: "Result not recorded");
		const matchStageLabel = getMatchStageLabel(match.match_stage);
		const periodLabel = isBasketballSport(match)
			? `Quarter ${match.game_period || 1}`
			: isVolleyballSport(match)
			? `Set ${match.game_period || 1}`
			: "";
		const periodLimit = isBasketballSport(match) ? 4 : isVolleyballSport(match) ? 5 : 0;
		if (isDone) {
			const doneCard = document.createElement("div");
			doneCard.className = "p-4 bg-white border-0 shadow-md rounded-lg";
			doneCard.innerHTML = `
			<div class="mb-3 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
			<p class="text-xs text-blue-700 uppercase tracking-wide mb-1">Sport</p>
			<p class="text-xl font-extrabold leading-tight text-blue-900">
			🏅 ${escapeHTML(getSportName(match))}
			</p>
			<p class="mt-1 text-xs font-semibold text-blue-700">${ownerLine}</p>
			</div>
			${matchStageLabel ? `<div class="mb-3 w-full rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-red-800">${escapeHTML(matchStageLabel)}</div>` : ""}
			${deleteRequestNotice}
			<div class="mb-3 bg-gray-50 border border-gray-200 rounded-lg p-3">
			<div class="flex items-center justify-between gap-3">
			<div class="text-center flex-1">
			<p class="text-lg font-extrabold leading-tight text-blue-700">${escapeHTML(firstTeamName)}</p>
			</div>
			<div class="px-2">
			<p class="text-gray-600 font-medium">vs</p>
			</div>
			<div class="text-center flex-1">
			<p class="text-lg font-extrabold leading-tight text-emerald-700">${escapeHTML(secondTeamName)}</p>
			</div>
			</div>
			</div>
			<div class="bg-green-50 border border-green-200 rounded-lg p-3">
			<p class="text-xs text-green-700 uppercase tracking-wide mb-2">Final Result</p>
			<p class="text-lg font-bold text-green-900">
			${escapeHTML(resultText)}
			</p>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-sm">
			<div>
			<p class="text-green-700">Winner</p>
			<p class="font-semibold text-green-900">${escapeHTML(history?.winner_team_name || "-")}</p>
			</div>
			<div>
			<p class="text-red-700">Loser</p>
			<p class="font-semibold text-red-900">${escapeHTML(history?.loser_team_name || "-")}</p>
			</div>
			</div>
			<div class="mt-3 rounded-lg bg-white/70 border border-green-100 p-3 text-sm">
			<p class="text-green-700">Best Player of the Game</p>
			<p class="font-semibold text-green-900">${escapeHTML(history?.best_player || "-")}</p>
			</div>
			<p class="text-xs text-green-700 mt-3">
			🔒 This match is Done. Result and status controls are locked.
			</p>
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
			<button
			type="button"
			data-match-id="${match.id}"
			class="delete-match-btn px-4 py-2 ${canManageCurrentMatch ? "bg-red-600 hover:bg-red-700 text-white" : lockedControlClasses} rounded-lg text-sm font-medium">
			Delete Match
			</button>
			</div>
			`;
			gridElement.appendChild(doneCard);
			return;
		}
		const flowNextClass = canManageCurrentMatch
			? "bg-green-600 hover:bg-green-700 text-white"
			: lockedControlClasses;
		const flowBackClass = canManageCurrentMatch
			? "bg-gray-200 hover:bg-gray-300 text-gray-700"
			: lockedControlClasses;
		const flowDoneClass = canManageCurrentMatch
			? "bg-green-600 hover:bg-green-700 text-white"
			: lockedControlClasses;
		const editButtonClass = canManageCurrentMatch
			? "bg-blue-600 hover:bg-blue-700 text-white"
			: lockedControlClasses;
		const deleteButtonClass = canManageCurrentMatch
			? "bg-red-600 hover:bg-red-700 text-white"
			: lockedControlClasses;
		const saveTimerButtonClass = canManageCurrentMatch
			? "bg-yellow-500 hover:bg-yellow-600 text-white"
			: lockedControlClasses;
		const periodControls = isOngoing && periodLimit ? `
		<div class="mb-2 w-full rounded-lg border border-red-300 bg-red-100 p-2.5">
		<p class="mb-2 text-xs font-bold uppercase tracking-wide text-red-800">${isBasketballSport(match) ? "Basketball Quarter" : "Volleyball Set"}</p>
		<div class="grid w-full gap-2" style="grid-template-columns: repeat(${periodLimit}, minmax(0, 1fr));">
		${Array.from({ length: periodLimit }, (_, index) => {
			const period = index + 1;
			const isSelected = Number(match.game_period || 1) === period;
			return `
			<button
			type="button"
			data-match-id="${match.id}"
			data-game-period="${period}"
			class="game-period-btn w-full rounded-lg px-3 py-2 text-xs font-bold ${isSelected ? "bg-red-700 text-white" : "bg-white text-red-700 hover:bg-red-200"}">
			${period}
			</button>
			`;
		}).join("")}
		</div>
		</div>
		` : "";
		const stageAndPeriodRow = matchStageLabel || (periodLabel && isOngoing) ? `
		<div class="mb-2 grid w-full ${matchStageLabel && periodLabel && isOngoing ? "grid-cols-2" : "grid-cols-1"} gap-2">
		${matchStageLabel ? `<div class="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-red-800">${escapeHTML(matchStageLabel)}</div>` : ""}
		${periodLabel && isOngoing ? `<div class="rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-red-800">${escapeHTML(periodLabel)}</div>` : ""}
		</div>
		` : "";
		const flowButtons = isNext ? `
		<button
		type="button"
		data-match-id="${match.id}"
		data-flow-action="toOngoing"
		class="flow-status-btn px-4 py-2 ${flowNextClass} rounded-lg text-sm font-medium">
		Next
		</button>
		` : `
		<button
		type="button"
		data-match-id="${match.id}"
		data-flow-action="toNext"
		class="flow-status-btn px-4 py-2 ${flowBackClass} rounded-lg text-sm font-medium">
		Back
		</button>
		<button
		type="button"
		data-match-id="${match.id}"
		data-flow-action="toDone"
		class="flow-status-btn px-4 py-2 ${flowDoneClass} rounded-lg text-sm font-medium">
		Done
		</button>
		`;
		const editButton = isOngoing ? `
		<button
		type="button"
		data-match-id="${match.id}"
		class="edit-match-btn px-4 py-2 ${editButtonClass} rounded-lg text-sm font-medium">
		Edit Match
		</button>
		` : "";
		const deleteButton = `
		<button
		type="button"
		data-match-id="${match.id}"
		class="delete-match-btn px-4 py-2 ${deleteButtonClass} rounded-lg text-sm font-medium">
		Delete Match
		</button>
		`;
		const matchCard = document.createElement("div");
		matchCard.className = isOngoing
			? "w-full max-w-6xl p-3 bg-white border-0 shadow-md rounded-lg"
			: "p-3 bg-white border-0 shadow-md rounded-lg";
		matchCard.innerHTML = `
		<div class="mb-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
		<p class="text-xs text-blue-700 uppercase tracking-wide mb-1">Sport</p>
		<p class="text-xl font-extrabold leading-tight text-blue-900">
		🏅 ${escapeHTML(getSportName(match))}
		</p>
		<p class="mt-1 text-xs font-semibold text-blue-700">${ownerLine}</p>
		</div>
		${stageAndPeriodRow}
		${deleteRequestNotice}
		${isNext ? `<div class="mb-2 rounded-lg border border-yellow-200 bg-yellow-50 p-2">
		<div class="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(8rem,1fr)_auto]">
		<div class="min-w-[8rem]">
		<p class="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-yellow-700">Timer</p>
		<p
		class="match-countdown text-4xl font-extrabold leading-none tracking-tight text-yellow-900"
		data-match-id="${match.id}"
		data-duration-seconds="${duration}"
		data-timer-enabled="${match.timer_enabled ? "true" : "false"}"
		data-started-at="${match.timer_started_at || ""}">
		${formatTimerDisplay(remainingSeconds)}
		</p>
		<p class="mt-1 text-[10px] font-semibold text-yellow-700">
		${match.timer_enabled ? "Live" : "Off"}
		</p>
		</div>
		<div class="grid grid-cols-[5rem_5rem_auto] items-end gap-1.5">
		<div>
		<label class="mb-0.5 block text-[10px] font-bold uppercase text-yellow-800">Min</label>
		<input
		type="number"
		min="0"
		value="${durationParts.minutes}"
		data-match-id="${match.id}"
		${timerFieldState}
		class="timer-minutes-input w-full rounded-md border border-yellow-300 px-2 py-1.5 text-sm">
		</div>
		<div>
		<label class="mb-0.5 block text-[10px] font-bold uppercase text-yellow-800">Sec</label>
		<input
		type="number"
		min="0"
		max="59"
		value="${durationParts.seconds}"
		data-match-id="${match.id}"
		${timerFieldState}
		class="timer-seconds-input w-full rounded-md border border-yellow-300 px-2 py-1.5 text-sm">
		</div>
		<button
		type="button"
		data-match-id="${match.id}"
		class="save-timer-duration-btn rounded-md px-2.5 py-1.5 text-xs font-bold ${saveTimerButtonClass}">
		Save
		</button>
		</div>
		</div>
		</div>` : ""}
		${periodControls}
		<div class="mb-2 flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
		<div class="text-center flex-1">
		<p class="text-xs uppercase tracking-wide text-gray-500 mb-1">Team 1</p>
		<p class="text-lg font-extrabold leading-tight text-blue-700">${escapeHTML(firstTeamName)}</p>
		</div>
		<div class="px-4">
		<p class="text-gray-600 font-medium">vs</p>
		</div>
		<div class="text-center flex-1">
		<p class="text-xs uppercase tracking-wide text-gray-500 mb-1">Team 2</p>
		<p class="text-lg font-extrabold leading-tight text-emerald-700">${escapeHTML(secondTeamName)}</p>
		</div>
		</div>
		${renderBasketballScoreSheet(match, canManageCurrentMatch)}
		<div class="border-t border-gray-200 pt-2">
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
		<div class="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5 sm:col-span-2">
		<div class="min-w-0 flex-1">
		<p class="mb-1 text-xs uppercase tracking-wide text-gray-500">Time</p>
		<p class="text-xs font-medium leading-tight text-gray-900">${formatDateTime(match.match_time)}</p>
		</div>
		<div class="min-w-0 flex-1 border-l border-gray-200 pl-3">
		<p class="mb-1 text-xs uppercase tracking-wide text-gray-500">Location</p>
		<p class="text-xs font-medium leading-tight text-gray-900">${escapeHTML(match.location || "No location set")}</p>
		</div>
		</div>
		${isNext ? `<div class="rounded-lg border border-gray-200 bg-gray-50 p-2 sm:col-span-2">
		<div class="flex items-center justify-between">
		<div>
		<p class="text-[10px] font-bold uppercase tracking-wide text-gray-500">Timer Signal</p>
		<p class="timer-label text-xs font-bold text-gray-900">
		${match.timer_enabled ? "Enabled" : "Disabled"}
		</p>
		</div>
		<label class="relative inline-flex items-center cursor-pointer">
		<input
		type="checkbox"
		data-match-id="${match.id}"
		class="timer-switch sr-only peer"
		${match.timer_enabled ? "checked" : ""}
		aria-disabled="${canManageCurrentMatch ? "false" : "true"}">
		<div class="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:bg-blue-600
		after:content-[''] after:absolute after:top-0.5 after:left-0.5
		after:bg-white after:border after:rounded-full after:h-5 after:w-5
		after:transition-all peer-checked:after:translate-x-5">
		</div>
		</label>
		</div>
		</div>` : ""}
		</div>
		<div class="mt-2 flex flex-wrap gap-2">
		${flowButtons}
		${editButton}
		${deleteButton}
		</div>
		</div>
		`;
		gridElement.appendChild(matchCard);
	});
	updateCountdownDisplays();
}

// --- Countdown timers --------------------------------------------------------
function splitTimerDuration(totalSeconds) {
	const safeSeconds = clampTimerSeconds(totalSeconds) || 600;
	return {
		minutes: Math.floor(safeSeconds / 60),
		seconds: safeSeconds % 60
	};
}

function getTimerDurationFromFields() {
	const minutes = Math.max(0, Number(dom.matchTimerMinutes.value) || 0);
	const seconds = Math.min(59, Math.max(0, Number(dom.matchTimerSeconds.value) || 0));
	const totalSeconds = Math.floor((minutes * 60) + seconds);
	return totalSeconds > 0 ? totalSeconds : 600;
}

export function updateCountdownDisplays() {
	document.querySelectorAll(".match-countdown").forEach(display => {
		const duration = clampTimerSeconds(display.dataset.durationSeconds) || 600;
		const isEnabled = display.dataset.timerEnabled === "true";
		const startedAt = display.dataset.startedAt;
		let remaining = duration;
		if (isEnabled && startedAt) {
			const startedAtMs = new Date(startedAt).getTime();
			if (!Number.isNaN(startedAtMs)) {
				const elapsed = Math.floor((Date.now() - startedAtMs) / 1000);
				remaining = Math.max(duration - elapsed, 0);
			}
		}
		display.textContent = formatTimerDisplay(remaining);
		if (isEnabled && remaining <= 0) {
			display.classList.add("text-red-700");
		} else {
			display.classList.remove("text-red-700");
		}
	});
}

function readCardTimerDuration(matchId) {
	const minutesInput = document.querySelector(`.timer-minutes-input[data-match-id="${matchId}"]`);
	const secondsInput = document.querySelector(`.timer-seconds-input[data-match-id="${matchId}"]`);
	const minutes = Math.max(0, Number(minutesInput?.value) || 0);
	const seconds = Math.min(59, Math.max(0, Number(secondsInput?.value) || 0));
	const totalSeconds = Math.floor((minutes * 60) + seconds);
	return totalSeconds > 0 ? totalSeconds : 600;
}

// --- Status / flow listeners -------------------------------------------------
export function setActiveStatusTab(status) {
	const selectedStatus = VALID_MATCH_STATUS_TABS.includes(status) ? status : "Next";
	state.activeStatusTab = selectedStatus;
	localStorage.setItem(COMMITTEE_MATCH_STATUS_TAB_KEY, selectedStatus);
	document.querySelectorAll(".match-status-tab").forEach(button => {
		const isActive = button.dataset.statusTab === selectedStatus;
		button.className = isActive
			? "match-status-tab px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white"
			: "match-status-tab px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300";
	});
	document.getElementById("nextMatchesTab").classList.toggle("hidden", selectedStatus !== "Next");
	document.getElementById("ongoingMatchesTab").classList.toggle("hidden", selectedStatus !== "Ongoing");
	document.getElementById("doneMatchesTab").classList.toggle("hidden", selectedStatus !== "Done");
}

function addStatusListeners() {
	document.querySelectorAll(".flow-status-btn").forEach(button => {
		button.addEventListener("click", async function () {
			const matchId = Number(this.dataset.matchId);
			const action = this.dataset.flowAction;
			const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
			if (!selectedMatch) {
				await loadSavedMatches();
				return;
			}
			if (!enforceMatchPermission(selectedMatch)) {
				await loadSavedMatches();
				return;
			}
			if (selectedMatch.status === "Done") {
				alert("This match is already Done. The result is locked.");
				await loadSavedMatches();
				return;
			}
			if (action === "toOngoing") {
				try {
					await updateMatchRecord(
						matchId,
						{
							status: "Ongoing",
							timer_enabled: false,
							timer_started_at: null,
							game_period: isBasketballSport(selectedMatch) || isVolleyballSport(selectedMatch) ? 1 : null
						},
						{ status: "Next" }
					);
				} catch (error) {
					console.error("Error moving match to On Going:", error.message || error);
					alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Error moving match to On Going.");
					await loadSavedMatches();
					return;
				}
				setActiveStatusTab("Ongoing");
				await loadSavedMatches();
				return;
			}
			if (action === "toNext") {
				try {
					await updateMatchRecord(
						matchId,
						{
							status: "Next",
							timer_enabled: false,
							timer_started_at: null,
							game_period: null
						},
						{ status: "Ongoing" }
					);
				} catch (error) {
					console.error("Error moving match back to Next:", error.message || error);
					alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Error moving match back to Next.");
					await loadSavedMatches();
					return;
				}
				setActiveStatusTab("Next");
				await loadSavedMatches();
				return;
			}
			if (action === "toDone") {
				if (selectedMatch.status !== "Ongoing") {
					alert("Only On Going matches can be marked as Done.");
					await loadSavedMatches();
					return;
				}
				openResultModalFunction(selectedMatch);
			}
		});
	});
}

function addGamePeriodListeners() {
	document.querySelectorAll(".game-period-btn").forEach(button => {
		button.addEventListener("click", async function () {
			const matchId = Number(this.dataset.matchId);
			const gamePeriod = Number(this.dataset.gamePeriod);
			const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
			if (!selectedMatch || selectedMatch.status !== "Ongoing") return;
			if (!enforceMatchPermission(selectedMatch)) return;
			try {
				await updateMatchRecord(matchId, { game_period: gamePeriod }, { status: "Ongoing" });
				await loadSavedMatches();
			} catch (error) {
				console.error("Error updating game period:", error.message || error);
				alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Unable to update the live game period.");
			}
		});
	});
}

function addBasketballScoreListeners() {
	document.querySelectorAll(".basketball-player-id-input").forEach(input => {
		input.addEventListener("click", function () {
			if ((!this.dataset.statId && !this.dataset.lineupStatId) || this.dataset.editingId === "true") {
				return;
			}
			this.dataset.editingId = "true";
			this.readOnly = false;
			this.value = this.dataset.idNumber || this.value;
			this.focus();
			this.select();
		});
		input.addEventListener("change", function () {
			if (!this.readOnly) {
				saveBasketballPlayerFromInput(this);
			}
		});
		input.addEventListener("keydown", function (event) {
			if (event.key === "Enter") {
				event.preventDefault();
				saveBasketballPlayerFromInput(this);
			}
		});
	});
	document.querySelectorAll(".basketball-points-btn").forEach(button => {
		button.addEventListener("click", function () {
			if (!this.dataset.statId && !this.dataset.lineupStatId && !this.dataset.idNumber) {
				alert("Please type and save the player ID first.");
				return;
			}
			openBasketballPointModal(this);
		});
	});
	document.querySelectorAll(".basketball-stat-adjust-btn").forEach(button => {
		button.addEventListener("click", async function () {
			if (!this.dataset.statId && !this.dataset.lineupStatId && !this.dataset.idNumber) {
				alert("Please type and save the player ID first.");
				return;
			}
			await addBasketballStatValue(
				this.dataset.statId,
				this.dataset.statField,
				Number(this.dataset.statAmount) || 0,
				{
					matchId: this.dataset.matchId,
					teamId: this.dataset.teamId,
					gamePeriod: this.dataset.gamePeriod,
					lineupStatId: this.dataset.lineupStatId,
					idNumber: this.dataset.idNumber
				}
			);
		});
	});
	document.querySelectorAll(".basketball-active-player-btn").forEach(button => {
		button.addEventListener("click", async function () {
			if (!this.dataset.statId && !this.dataset.lineupStatId) {
				alert("Please type and save the player ID first.");
				return;
			}
			await toggleBasketballActivePlayer(
				this.dataset.statId,
				this.dataset.isActive !== "true",
				{
					lineupStatId: this.dataset.lineupStatId,
					matchId: this.dataset.matchId,
					teamId: this.dataset.teamId,
					gamePeriod: this.dataset.gamePeriod
				}
			);
		});
	});
}

async function saveTimerDuration(matchId, shouldRestartIfRunning = true) {
	const selectedMatch = state.matchesData.find(match => Number(match.id) === Number(matchId));
	if (!selectedMatch) {
		await loadSavedMatches();
		return;
	}
	if (!enforceMatchPermission(selectedMatch)) {
		await loadSavedMatches();
		return;
	}
	if (selectedMatch.status === "Done") {
		alert("Timer cannot be changed because this match is already Done.");
		await loadSavedMatches();
		return;
	}
	const durationSeconds = readCardTimerDuration(matchId);
	const updatePayload = {
		timer_duration_seconds: durationSeconds
	};
	if (selectedMatch.timer_enabled && shouldRestartIfRunning) {
		updatePayload.timer_started_at = new Date().toISOString();
	}
	try {
		await updateMatchRecord(matchId, updatePayload);
	} catch (error) {
		console.error("Error saving timer duration:", error.message || error);
		alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Error saving timer duration.");
		await loadSavedMatches();
		return;
	}
	await loadSavedMatches();
}

function addTimerControlListeners() {
	document.querySelectorAll(".save-timer-duration-btn").forEach(button => {
		button.addEventListener("click", async function () {
			await saveTimerDuration(Number(this.dataset.matchId), true);
		});
	});
}

function addEditMatchListeners() {
	document.querySelectorAll(".edit-match-btn").forEach(button => {
		button.addEventListener("click", function () {
			const matchId = Number(this.dataset.matchId);
			const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
			openEditMatchModalFunction(selectedMatch);
		});
	});
}

function addDeleteMatchListeners() {
	document.querySelectorAll(".delete-match-btn").forEach(button => {
		button.addEventListener("click", async function () {
			const matchId = Number(this.dataset.matchId);
			const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
			if (!selectedMatch) {
				await loadSavedMatches();
				return;
			}
			if (!enforceMatchPermission(selectedMatch)) {
				await loadSavedMatches();
				return;
			}
			if (selectedMatch.delete_requested) {
				alert("This match already has a delete request waiting for admin approval.");
				await loadSavedMatches();
				return;
			}
			const shouldDelete = await showDashboardConfirm("Request admin approval to delete this match?", {
				title: "Request Match Delete",
				confirmText: "Send Request"
			});
			if (!shouldDelete) {
				return;
			}
			this.disabled = true;
			this.textContent = "Requesting...";
			try {
				await requestMatchDeleteApproval(selectedMatch);
				showDashboardToast("Delete request sent. An admin must approve it before the match is removed.", "warning");
				await loadSavedMatches();
			} catch (error) {
				console.error("Delete request error:", error.message || error);
				alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Error sending delete request.");
				await loadSavedMatches();
			} finally {
				this.disabled = false;
				this.textContent = "Delete Match";
			}
		});
	});
}

function addTimerListeners() {
	document.querySelectorAll(".timer-switch").forEach(timerSwitch => {
		timerSwitch.addEventListener("change", async function () {
			const matchId = Number(this.dataset.matchId);
			const isEnabled = this.checked;
			const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
			if (!selectedMatch) {
				await loadSavedMatches();
				return;
			}
			if (!enforceMatchPermission(selectedMatch)) {
				this.checked = Boolean(selectedMatch.timer_enabled);
				await loadSavedMatches();
				return;
			}
			if (selectedMatch.status === "Done") {
				alert("Timer cannot be changed because this match is already Done.");
				await loadSavedMatches();
				return;
			}
			const durationSeconds = readCardTimerDuration(matchId);
			const updatePayload = {
				timer_enabled: isEnabled,
				timer_duration_seconds: durationSeconds,
				timer_started_at: isEnabled ? new Date().toISOString() : null
			};
			try {
				await updateMatchRecord(matchId, updatePayload);
			} catch (error) {
				console.error("Error updating timer signal:", error.message || error);
				alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Error updating timer signal.");
				await loadSavedMatches();
				return;
			}
			await loadSavedMatches();
		});
	});
}

// --- Schedule / edit modal ---------------------------------------------------
function updateMatchStageOptions() {
	const selectedSport = state.registeredSportsData.find(sport => String(sport.id) === String(dom.matchSport.value));
	const showBattleForThird = isBasketballSport(selectedSport?.sport_name || "");
	dom.battleForThirdOption.hidden = !showBattleForThird;
	if (!showBattleForThird && dom.matchStage.value === "battle_for_third") {
		dom.matchStage.value = "regular";
	}
}

export function openMatchModalFunction() {
	dom.matchForm.reset();
	dom.editingMatchId.value = "";
	dom.matchModalTitle.textContent = "Schedule Match";
	dom.matchSubmitButton.textContent = "Save Match";
	dom.matchTimerMinutes.value = 10;
	dom.matchTimerSeconds.value = 0;
	updateMatchStageOptions();
	dom.matchModal.classList.remove("hidden");
	dom.matchModal.classList.add("flex");
}

export function openEditMatchModalFunction(match) {
	if (!match) {
		alert("Match not found.");
		return;
	}
	if (!enforceMatchPermission(match)) {
		return;
	}
	if (match.status !== "Ongoing") {
		alert("A match can only be edited while it is On Going.");
		return;
	}
	const durationParts = splitTimerDuration(match.timer_duration_seconds);
	dom.matchForm.reset();
	dom.editingMatchId.value = match.id;
	dom.matchModalTitle.textContent = "Edit On Going Match";
	dom.matchSubmitButton.textContent = "Update Match";
	dom.matchSport.value = match.sport_id || "";
	dom.matchStage.value = match.match_stage || "regular";
	updateMatchStageOptions();
	dom.teamOne.value = match.team_one_id || "";
	dom.teamTwo.value = match.team_two_id || "";
	dom.matchTime.value = formatForDateTimeLocal(match.match_time);
	dom.matchLocation.value = match.location || "";
	dom.matchTimerMinutes.value = durationParts.minutes;
	dom.matchTimerSeconds.value = durationParts.seconds;
	dom.matchModal.classList.remove("hidden");
	dom.matchModal.classList.add("flex");
}

export function closeMatchModalFunction() {
	dom.matchModal.classList.add("hidden");
	dom.matchModal.classList.remove("flex");
	dom.matchForm.reset();
	dom.editingMatchId.value = "";
	dom.matchModalTitle.textContent = "Schedule Match";
	dom.matchSubmitButton.textContent = "Save Match";
}

export async function saveMatch(event) {
	event.preventDefault();
	if (!dom.matchSport.value) {
		alert("Please select a sport or game category before scheduling the match.");
		dom.matchSport.focus();
		return;
	}
	const selectedSport = state.registeredSportsData.find(sport => String(sport.id) === String(dom.matchSport.value));
	if (!selectedSport) {
		alert("Please choose a valid sport category from the list.");
		dom.matchSport.focus();
		return;
	}
	if (selectedSport && !isSportVisibleForCurrentUser(selectedSport)) {
		alert("This sport category is not available for your account assignment.");
		dom.matchSport.focus();
		return;
	}
	if (dom.teamOne.value === dom.teamTwo.value) {
		alert("Please select two different teams.");
		return;
	}
	const timerDurationSeconds = getTimerDurationFromFields();
	const matchData = {
		sport_id: Number(dom.matchSport.value),
		team_one_id: Number(dom.teamOne.value),
		team_two_id: Number(dom.teamTwo.value),
		match_time: new Date(dom.matchTime.value).toISOString(),
		location: dom.matchLocation.value.trim(),
		match_stage: dom.matchStage.value || "regular",
		timer_duration_seconds: timerDurationSeconds
	};
	const currentEditingMatchId = Number(dom.editingMatchId.value);
	if (currentEditingMatchId) {
		const selectedMatch = state.matchesData.find(match => Number(match.id) === currentEditingMatchId);
		if (!selectedMatch || selectedMatch.status !== "Ongoing") {
			alert("Only On Going matches can be edited.");
			await loadSavedMatches();
			closeMatchModalFunction();
			return;
		}
		if (!enforceMatchPermission(selectedMatch)) {
			await loadSavedMatches();
			closeMatchModalFunction();
			return;
		}
		const updatePayload = {
			...matchData
		};
		if (selectedMatch.timer_enabled) {
			updatePayload.timer_started_at = new Date().toISOString();
		}
		try {
			await updateMatchRecord(currentEditingMatchId, updatePayload, { status: "Ongoing" });
		} catch (error) {
			console.error("Error updating match:", error.message || error);
			alert(error.message === MATCH_PERMISSION_MESSAGE ? MATCH_PERMISSION_MESSAGE : "Error updating match.");
			return;
		}
		alert("On Going match updated successfully.");
		closeMatchModalFunction();
		await loadSavedMatches();
		return;
	}
	if (!getCurrentUserCreatorKey()) {
		alert("Unable to identify the logged-in user. Please sign in again.");
		window.location.href = "index.html";
		return;
	}
	const insertPayload = {
		...matchData,
		status: "Next",
		timer_enabled: false,
		timer_started_at: null,
		game_period: null,
		created_by: getCurrentUserCreatorKey(),
		created_by_role: state.currentUser?.role || "committee",
		created_by_name: getCurrentUserDisplayName()
	};
	const { error } = await supabase
		.from(MATCHES_TABLE)
		.insert([insertPayload]);
	if (error) {
		console.error("Error saving match:", error.message || error);
		alert("Error saving match to Supabase.");
		return;
	}
	alert("Match scheduled successfully!");
	setActiveStatusTab("Next");
	closeMatchModalFunction();
	await loadSavedMatches();
}

// --- Result modal (declare winner) -------------------------------------------
export function openResultModalFunction(match) {
	if (!enforceMatchPermission(match)) {
		return;
	}
	state.pendingResultMatch = match;
	dom.resultForm.reset();
	dom.resultMatchId.value = match.id;
	const firstTeamId = getTeamId(match, "one");
	const secondTeamId = getTeamId(match, "two");
	const firstTeamName = getTeamName(match, "one");
	const secondTeamName = getTeamName(match, "two");
	const usesScoreSheet = hasPlayerScoreSheet(match);
	const faultLabel = getScoreSheetFaultLabel(match);
	const teamOneTotals = getBasketballTotals(match, "one");
	const teamTwoTotals = getBasketballTotals(match, "two");
	dom.teamOneAdjustmentTitle.textContent = firstTeamName || "Team 1";
	dom.teamTwoAdjustmentTitle.textContent = secondTeamName || "Team 2";
	dom.winnerTeamSelect.closest("div")?.classList.toggle("hidden", usesScoreSheet);
	dom.winnerActualPointsInput.closest("label")?.classList.toggle("hidden", usesScoreSheet);
	dom.loserActualPointsInput.closest("label")?.classList.toggle("hidden", usesScoreSheet);
	dom.winnerTeamSelect.required = !usesScoreSheet;
	dom.winnerActualPointsInput.required = !usesScoreSheet;
	dom.loserActualPointsInput.required = !usesScoreSheet;
	dom.bestPlayerInput.placeholder = usesScoreSheet
		? "Enter Player of the Game ID number"
		: "Enter the best player's name";
	dom.resultMatchSummary.innerHTML = `
	<p class="text-xs text-blue-700 uppercase tracking-wide mb-1">Sport</p>
	<p class="font-semibold text-blue-900 mb-3">
	🏅 ${escapeHTML(getSportName(match))}
	</p>
	<p class="font-semibold text-gray-900 mb-1">
	${escapeHTML(firstTeamName)} vs ${escapeHTML(secondTeamName)}
	</p>
	${usesScoreSheet ? `
	<div class="mt-3 grid grid-cols-2 gap-2 text-center">
	<div class="rounded-lg border border-blue-200 bg-blue-50 p-3">
	<p class="text-xs font-black uppercase text-blue-700">${escapeHTML(firstTeamName)}</p>
	<p class="text-3xl font-black text-blue-700">${teamOneTotals.points}</p>
	<p class="text-xs font-bold text-blue-600">${faultLabel} ${teamOneTotals.fouls}</p>
	</div>
	<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
	<p class="text-xs font-black uppercase text-emerald-700">${escapeHTML(secondTeamName)}</p>
	<p class="text-3xl font-black text-emerald-700">${teamTwoTotals.points}</p>
	<p class="text-xs font-bold text-emerald-600">${faultLabel} ${teamTwoTotals.fouls}</p>
	</div>
	</div>
	<p class="mt-3">${isBasketballSport(match) ? "Basketball" : "Volleyball"} winner will be declared automatically from the highest score.</p>
	` : `<p>Declare who won before this match can be marked as <strong>Done</strong>.</p>`}
	`;
	dom.winnerTeamSelect.innerHTML = `
	<option value="">Select winner</option>
	<option value="${firstTeamId}">${escapeHTML(firstTeamName)}</option>
	<option value="${secondTeamId}">${escapeHTML(secondTeamName)}</option>
	`;
	dom.resultModal.classList.remove("hidden");
	dom.resultModal.classList.add("flex");
}

export function closeResultModalFunction() {
	dom.resultModal.classList.add("hidden");
	dom.resultModal.classList.remove("flex");
	dom.resultForm.reset();
	state.pendingResultMatch = null;
}

export async function saveMatchResult(event) {
	event.preventDefault();
	if (!state.pendingResultMatch) {
		alert("No match selected.");
		return;
	}
	if (!enforceMatchPermission(state.pendingResultMatch)) {
		closeResultModalFunction();
		await loadSavedMatches();
		return;
	}
	if (state.pendingResultMatch.status !== "Ongoing") {
		alert("Only On Going matches can be marked as Done.");
		closeResultModalFunction();
		await loadSavedMatches();
		return;
	}
	const submitButton = dom.resultForm.querySelector('button[type="submit"]');
	const usesScoreSheet = hasPlayerScoreSheet(state.pendingResultMatch);
	const teamOneTotals = getBasketballTotals(state.pendingResultMatch, "one");
	const teamTwoTotals = getBasketballTotals(state.pendingResultMatch, "two");
	let winnerId = Number(dom.winnerTeamSelect.value);
	const bestPlayerRaw = dom.bestPlayerInput.value.trim();
	let bestPlayer = bestPlayerRaw;
	let winnerPointsAwarded = Number(dom.winnerActualPointsInput.value);
	let loserPointsAwarded = Number(dom.loserActualPointsInput.value);
	const readAdjustmentPoints = (input, label) => {
		const rawValue = String(input.value || "").trim();
		const value = rawValue === "" ? 0 : Number(rawValue);
		if (!Number.isFinite(value) || value < 0) {
			alert(`Please enter valid ${label}.`);
			input.focus();
			return null;
		}
		return value;
	};
	const teamOneMeritPoints = readAdjustmentPoints(dom.teamOneMeritPointsInput, "Team 1 merit points");
	if (teamOneMeritPoints === null) return;
	const teamOneDemeritPoints = readAdjustmentPoints(dom.teamOneDemeritPointsInput, "Team 1 demerit points");
	if (teamOneDemeritPoints === null) return;
	const teamTwoMeritPoints = readAdjustmentPoints(dom.teamTwoMeritPointsInput, "Team 2 merit points");
	if (teamTwoMeritPoints === null) return;
	const teamTwoDemeritPoints = readAdjustmentPoints(dom.teamTwoDemeritPointsInput, "Team 2 demerit points");
	if (teamTwoDemeritPoints === null) return;
	if (usesScoreSheet) {
		if (teamOneTotals.points === teamTwoTotals.points) {
			alert(`${isBasketballSport(state.pendingResultMatch) ? "Basketball" : "Volleyball"} scores are tied. Update the score sheet before marking Done.`);
			return;
		}
		winnerId = teamOneTotals.points > teamTwoTotals.points
			? getTeamId(state.pendingResultMatch, "one")
			: getTeamId(state.pendingResultMatch, "two");
		winnerPointsAwarded = Math.max(teamOneTotals.points, teamTwoTotals.points);
		loserPointsAwarded = Math.min(teamOneTotals.points, teamTwoTotals.points);
	}
	if (!winnerId) {
		alert("Please select the winning team.");
		return;
	}
	if (!bestPlayerRaw) {
		alert(usesScoreSheet
			? "Please enter the Player of the Game ID number before marking this match as Done."
			: "Please enter the best player of the game before marking this match as Done.");
		dom.bestPlayerInput.focus();
		return;
	}
	if (usesScoreSheet) {
		const bestPlayerParticipant = await findParticipantByIdNumber(bestPlayerRaw);
		if (!bestPlayerParticipant) {
			const allowUnknownBestPlayer = await showDashboardConfirm(`Player of the Game ID ${bestPlayerRaw} was not found in participants. Save anyway?`, {
				title: "Save Unknown Player",
				confirmText: "Save Anyway"
			});
			if (!allowUnknownBestPlayer) {
				dom.bestPlayerInput.focus();
				return;
			}
		}
		bestPlayer = bestPlayerParticipant
			? `${getParticipantDisplayName(bestPlayerParticipant) || bestPlayerRaw} (${bestPlayerRaw})`
			: bestPlayerRaw;
	}
	if (!Number.isFinite(winnerPointsAwarded) || winnerPointsAwarded < 0) {
		alert("Please enter valid actual points for the winning team.");
		dom.winnerActualPointsInput.focus();
		return;
	}
	if (!Number.isFinite(loserPointsAwarded) || loserPointsAwarded < 0) {
		alert("Please enter valid actual points for the losing team.");
		dom.loserActualPointsInput.focus();
		return;
	}
	const teamOneId = getTeamId(state.pendingResultMatch, "one");
	const teamTwoId = getTeamId(state.pendingResultMatch, "two");
	const teamOneName = getTeamName(state.pendingResultMatch, "one");
	const teamTwoName = getTeamName(state.pendingResultMatch, "two");
	if (winnerId !== teamOneId && winnerId !== teamTwoId) {
		alert("Winner must be one of the teams in the match.");
		return;
	}
	const loserId = winnerId === teamOneId ? teamTwoId : teamOneId;
	const winnerName = winnerId === teamOneId ? teamOneName : teamTwoName;
	const loserName = loserId === teamOneId ? teamOneName : teamTwoName;
	submitButton.disabled = true;
	submitButton.textContent = "Saving...";
	try {
		const historyPayload = {
			match_id: state.pendingResultMatch.id,
			sport_id: state.pendingResultMatch.sport_id || null,
			sport_name: getSportName(state.pendingResultMatch),
			team_one_id: teamOneId,
			team_two_id: teamTwoId,
			team_one_name: teamOneName,
			team_two_name: teamTwoName,
			winner_team_id: winnerId,
			winner_team_name: winnerName,
			loser_team_id: loserId,
			loser_team_name: loserName,
			winner_points_awarded: winnerPointsAwarded,
			loser_points_awarded: loserPointsAwarded,
			team_one_merit_points: teamOneMeritPoints,
			team_one_merit_remarks: dom.teamOneMeritRemarksInput.value.trim(),
			team_one_demerit_points: teamOneDemeritPoints,
			team_one_demerit_remarks: dom.teamOneDemeritRemarksInput.value.trim(),
			team_two_merit_points: teamTwoMeritPoints,
			team_two_merit_remarks: dom.teamTwoMeritRemarksInput.value.trim(),
			team_two_demerit_points: teamTwoDemeritPoints,
			team_two_demerit_remarks: dom.teamTwoDemeritRemarksInput.value.trim(),
			best_player: bestPlayer,
			match_time: state.pendingResultMatch.match_time,
			location: state.pendingResultMatch.location || "",
			result: `${winnerName} won against ${loserName}`,
			declared_at: new Date().toISOString()
		};
		const { data: existingHistory, error: findHistoryError } = await supabase
			.from(GAME_HISTORY_TABLE)
			.select("id")
			.eq("match_id", state.pendingResultMatch.id)
			.maybeSingle();
		if (findHistoryError) {
			throw findHistoryError;
		}
		let historyResult;
		if (existingHistory) {
			historyResult = await supabase
				.from(GAME_HISTORY_TABLE)
				.update(historyPayload)
				.eq("match_id", state.pendingResultMatch.id);
		} else {
			historyResult = await supabase
				.from(GAME_HISTORY_TABLE)
				.insert([historyPayload]);
		}
		if (historyResult.error) {
			throw historyResult.error;
		}
		await updateMatchRecord(
			state.pendingResultMatch.id,
			{
				status: "Done",
				timer_enabled: false,
				timer_started_at: null
			},
			{ status: "Ongoing" }
		);
		alert("Result saved. Match marked as Done.");
		setActiveStatusTab("Done");
		closeResultModalFunction();
		await loadSavedMatches();
	} catch (err) {
		console.error("Save result error:", err.message || err);
		alert(err.message || "Failed to save game history.");
	} finally {
		submitButton.disabled = false;
		submitButton.textContent = "Save Result and Mark Done";
	}
}

// --- Scope + sport filters ---------------------------------------------------
export function setActiveMatchScopeFilter(scope) {
	state.activeMatchScopeFilter = scope === "all" && canCurrentUserUseMatchViewFilters() ? "all" : "mine";
	localStorage.setItem(COMMITTEE_MATCH_SCOPE_KEY, state.activeMatchScopeFilter);
	document.querySelectorAll(".match-scope-tab").forEach(button => {
		const isActive = button.dataset.matchScopeTab === state.activeMatchScopeFilter;
		button.className = isActive
			? "match-scope-tab px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 text-white"
			: "match-scope-tab px-3 py-1.5 rounded-md text-xs font-semibold text-gray-700 hover:bg-white";
	});
	updateSportFilterButtonVisibility();
	renderMatches(state.matchesData);
}

function updateSportFilterButtonVisibility() {
	const canUseFilters = canCurrentUserUseMatchViewFilters();
	if (dom.matchViewFilterCard) {
		dom.matchViewFilterCard.classList.toggle("hidden", !canUseFilters);
	}
	if (!dom.openSportFilterModal) {
		return;
	}
	const shouldShowSportFilter = canUseFilters && state.activeMatchScopeFilter === "all";
	dom.openSportFilterModal.classList.toggle("hidden", !shouldShowSportFilter);
	if (!shouldShowSportFilter && state.activeSportFilterId) {
		state.activeSportFilterId = "";
		if (dom.sportFilterSelect) {
			dom.sportFilterSelect.value = "";
		}
	}
}

export function openSportFilterModalFunction() {
	if (!canCurrentUserUseMatchViewFilters() || state.activeMatchScopeFilter !== "all") {
		return;
	}
	if (dom.sportFilterSelect) {
		dom.sportFilterSelect.value = state.activeSportFilterId;
	}
	dom.sportFilterModal.classList.remove("hidden");
	dom.sportFilterModal.classList.add("flex");
}

export function closeSportFilterModalFunction() {
	dom.sportFilterModal.classList.add("hidden");
	dom.sportFilterModal.classList.remove("flex");
}

export function populateSportFilterOptions(sports) {
	state.registeredSportsData = Array.isArray(sports) ? sports : [];
	if (!dom.sportFilterSelect) {
		return;
	}
	const previousValue = state.activeSportFilterId;
	dom.sportFilterSelect.innerHTML = `<option value="">All registered sports</option>`;
	state.registeredSportsData.forEach(sport => {
		const option = document.createElement("option");
		option.value = sport.id;
		option.textContent = sport.sport_name;
		dom.sportFilterSelect.appendChild(option);
	});
	const selectedSportStillExists = !previousValue
		|| state.registeredSportsData.some(sport => String(sport.id) === String(previousValue));
	state.activeSportFilterId = selectedSportStillExists ? previousValue : "";
	dom.sportFilterSelect.value = state.activeSportFilterId;
}

export function handleSportFilterChange() {
	state.activeSportFilterId = dom.sportFilterSelect.value || "";
	closeSportFilterModalFunction();
	renderMatches(state.matchesData);
}

export function clearSportFilterSelection() {
	state.activeSportFilterId = "";
	dom.sportFilterSelect.value = "";
	closeSportFilterModalFunction();
	renderMatches(state.matchesData);
}

// --- Done-date filter + basketball point modal wiring ------------------------
export function handleDoneDateFilterChange() {
	state.activeDoneMatchesDate = dom.doneMatchesDateFilter.value || "";
	renderMatches(state.matchesData);
}

export function clearDoneDateFilter() {
	state.activeDoneMatchesDate = "";
	dom.doneMatchesDateFilter.value = "";
	renderMatches(state.matchesData);
}

export function openDoneDatePicker() {
	if (typeof dom.doneMatchesDateFilter.showPicker === "function") {
		dom.doneMatchesDateFilter.showPicker();
	} else {
		dom.doneMatchesDateFilter.focus();
		dom.doneMatchesDateFilter.click();
	}
}

export async function handleBasketballPointChoice(button) {
	if (!state.pendingBasketballPointTarget?.statId && !state.pendingBasketballPointTarget?.lineupStatId && !state.pendingBasketballPointTarget?.idNumber) {
		closeBasketballPointModalFunction();
		return;
	}
	await addBasketballStatValue(
		state.pendingBasketballPointTarget.statId,
		"points",
		Number(button.dataset.basketballPoints) || 0,
		state.pendingBasketballPointTarget
	);
	closeBasketballPointModalFunction();
}
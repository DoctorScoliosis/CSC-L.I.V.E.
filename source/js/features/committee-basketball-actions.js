/*
 * Basketball / volleyball score-sheet ACTIONS for the Committee dashboard:
 * saving players by ID, adding points/fouls, toggling active players, and
 * the +1/+2/+3 point modal.
 *
 * These mutate basketball_match_player_stats and then reload the match list,
 * so this module imports committee-match-data.js (loadSavedMatches). The
 * sheet renderer lives separately in committee-basketball-sheet.js to keep
 * the dependency one-directional.
 */

import { state, supabase, dom, BASKETBALL_STATS_TABLE, PARTICIPANTS_TABLE } from "../pages/committee-context.js";
import {
	getTeamName,
	normalizeTeamValue,
	isVolleyballSport,
	getScoreSheetPeriodLimit,
	getScoreSheetPeriodLabel,
	getScoreSheetFaultLabel,
	getParticipantDisplayName,
	enforceMatchPermission
} from "./committee-match-helpers.js";
import {
	getBasketballStatsForMatch,
	getBasketballActivePeriod
} from "./committee-basketball-sheet.js";
import { loadSavedMatches } from "./committee-match-data.js";

export async function findParticipantByIdNumber(idNumber) {
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

export async function saveBasketballRosterPlayer({ matchId, teamId, payload, lineupStatId, previousIdNumber }) {
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

export async function saveBasketballPlayerFromInput(input) {
	const idNumber = String(input.value || "").trim();
	if (!idNumber) return;
	if (input.dataset.saving === "true") return;
	const matchId = Number(input.dataset.matchId);
	const teamId = Number(input.dataset.teamId);
	const selectedMatch = state.matchesData.find(match => Number(match.id) === matchId);
	if (!selectedMatch || !enforceMatchPermission(selectedMatch)) return;
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

export async function consolidateBasketballDuplicateRows(matchId) {
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

export function openBasketballPointModal(button) {
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

export async function ensureBasketballPeriodStatRow(statId, options = {}) {
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

export async function addBasketballStatValue(statId, field, amount, options = {}) {
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

export async function toggleBasketballActivePlayer(statId, nextActive, options = {}) {
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
/*
 * Team leaderboard engine, shared by the Student and Committee dashboards.
 *
 * Owns three things:
 *   1. buildLeaderboardRows — computes points / wins / losses per team from
 *      game_history, applies merit/demerit adjustments, and adds the daily
 *      home-college attendance bonus (+5 per team/day with 100+ present).
 *   2. renderLeaderboardRows — draws the ranked table rows (medals, points
 *      badge, victory/defeated counts) into a <tbody> you pass in.
 *   3. animateLeaderboardRows — the FLIP animation that slides rows when
 *      ranks change and tints them green (up) / amber (down).
 *
 * The data model note that matters: teams are listed from sports_leaderboard
 * only to get registered names. Points/wins/losses are derived from
 * game_history — the sports_leaderboard points/wins/losses columns are NOT
 * read. Do not "optimise" this to read those columns.
 */

import { escapeHTML } from "../utils/dom.js";

// --- Computation -------------------------------------------------------------

function normalizeText(value) {
	return String(value ?? "").trim().toLowerCase();
}

function getFirstValue(...values) {
	for (const value of values) {
		if (value !== null && value !== undefined && value !== "") {
			return value;
		}
	}
	return null;
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

function getHistoryTeamAdjustment(history, teamId, teamName) {
	const normalizedTeamName = String(teamName || "").trim().toLowerCase();
	const isTeamOne = (history.team_one_id && Number(history.team_one_id) === Number(teamId))
		|| (normalizedTeamName && String(history.team_one_name || "").trim().toLowerCase() === normalizedTeamName);
	const isTeamTwo = (history.team_two_id && Number(history.team_two_id) === Number(teamId))
		|| (normalizedTeamName && String(history.team_two_name || "").trim().toLowerCase() === normalizedTeamName);
	if (isTeamOne) {
		return (Number(history.team_one_merit_points) || 0) - (Number(history.team_one_demerit_points) || 0);
	}
	if (isTeamTwo) {
		return (Number(history.team_two_merit_points) || 0) - (Number(history.team_two_demerit_points) || 0);
	}
	return 0;
}

function isPresentAttendanceStatus(status) {
	return normalizeText(status || "Present") === "present";
}

function getAttendanceBonusDate(row) {
	if (row.attendance_date) {
		return String(row.attendance_date).slice(0, 10);
	}
	if (row.checked_at) {
		return String(row.checked_at).slice(0, 10);
	}
	return "";
}

function buildAttendanceBonusRows(attendanceRows) {
	const groups = new Map();
	(attendanceRows || []).forEach(row => {
		const team = String(row.home_college || row.team || "").trim();
		const date = getAttendanceBonusDate(row);
		if (!team || !date || !isPresentAttendanceStatus(row.status)) {
			return;
		}
		const key = `${normalizeText(team)}|${date}`;
		if (!groups.has(key)) {
			groups.set(key, { team, date, students: new Set() });
		}
		const studentKey = String(row.student_id || row.participant_id || "").trim();
		if (!studentKey) {
			return;
		}
		groups.get(key).students.add(studentKey);
	});
	return [...groups.values()]
		.filter(group => group.students.size >= 100)
		.map(group => ({
			team: group.team,
			date: group.date,
			attendanceCount: group.students.size,
			points: 5
		}));
}

export function buildLeaderboardRows(teams, historyRows, attendanceRows = []) {
	const teamStats = new Map();
	const registeredTeamAliases = new Map();

	function makeTeamKey(teamId, teamName) {
		if (teamId !== null && teamId !== undefined && teamId !== "") {
			return `id:${teamId}`;
		}
		return `name:${normalizeText(teamName || "Unknown Team")}`;
	}
	function addTeam(teamId, teamName, baseValues = {}) {
		const safeTeamName = teamName || baseValues.team || baseValues.name || "Unknown Team";
		const key = makeTeamKey(teamId, safeTeamName);
		if (!teamStats.has(key)) {
			teamStats.set(key, {
				id: teamId || baseValues.id || null,
				team: safeTeamName,
				points: 0,
				wins: 0,
				losses: 0
			});
		}
		return teamStats.get(key);
	}
	function registerTeamAliases(teamId, teamName, teamStat) {
		if (teamId !== null && teamId !== undefined && teamId !== "") {
			registeredTeamAliases.set(`id:${teamId}`, teamStat);
		}
		const normalizedTeamName = normalizeText(teamName);
		if (normalizedTeamName) {
			registeredTeamAliases.set(`name:${normalizedTeamName}`, teamStat);
		}
	}
	function getRegisteredTeamStat(teamId, teamName) {
		if (teamId !== null && teamId !== undefined && teamId !== "") {
			const byId = registeredTeamAliases.get(`id:${teamId}`);
			if (byId) {
				return byId;
			}
		}
		const normalizedTeamName = normalizeText(teamName);
		if (normalizedTeamName) {
			return registeredTeamAliases.get(`name:${normalizedTeamName}`) || null;
		}
		return null;
	}

	(teams || []).forEach(team => {
		const teamName = team.team || team.team_name || team.name;
		const teamStat = addTeam(team.id, teamName, team);
		registerTeamAliases(team.id, teamName, teamStat);
	});

	(historyRows || []).forEach(history => {
		const winnerId = getFirstValue(history.winner_team_id, history.winning_team_id, history.winner_id, history.team_winner_id);
		const winnerName = getFirstValue(history.winner_team_name, history.winning_team_name, history.winner_name, history.winner);
		const loserId = getFirstValue(history.loser_team_id, history.losing_team_id, history.loser_id, history.team_loser_id);
		const loserName = getFirstValue(history.loser_team_name, history.losing_team_name, history.loser_name, history.loser);
		if (winnerId || winnerName) {
			const winner = getRegisteredTeamStat(winnerId, winnerName);
			if (winner) {
				winner.points += resolveHistoryPoints(history, "winner") + getHistoryTeamAdjustment(history, winnerId, winnerName);
				winner.wins += 1;
			}
		}
		if (loserId || loserName) {
			const loser = getRegisteredTeamStat(loserId, loserName);
			if (loser) {
				loser.points += resolveHistoryPoints(history, "loser") + getHistoryTeamAdjustment(history, loserId, loserName);
				loser.losses += 1;
			}
		}
	});

	buildAttendanceBonusRows(attendanceRows).forEach(bonus => {
		const team = getRegisteredTeamStat(null, bonus.team);
		if (team) {
			team.points += bonus.points;
		}
	});

	return Array.from(teamStats.values()).sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.wins !== a.wins) return b.wins - a.wins;
		if (a.losses !== b.losses) return a.losses - b.losses;
		return String(a.team).localeCompare(String(b.team));
	});
}

// --- Rendering ---------------------------------------------------------------

export function renderLeaderboardRows(tbody, leaderboardRows, options = {}) {
	const onTeamClick = options.onTeamClick || null;
	const emptyMessage = options.emptyMessage || "No leaderboard data available yet.";

	if (!leaderboardRows || leaderboardRows.length === 0) {
		tbody.innerHTML = `
		<tr>
		<td colspan="5" class="text-center py-16 text-slate-500">
		${escapeHTML(emptyMessage)}
		</td>
		</tr>
		`;
		return;
	}

	const previousPositions = new Map(
		[...tbody.querySelectorAll("tr[data-team-key]")]
			.map(row => [row.dataset.teamKey, row.getBoundingClientRect().top])
	);
	const previousRanks = new Map(
		[...tbody.querySelectorAll("tr[data-team-key]")]
			.map(row => [row.dataset.teamKey, Number(row.dataset.rank)])
	);

	tbody.innerHTML = "";
	leaderboardRows.forEach((team, index) => {
		const rankLabel = index < 3
			? ["&#129351;", "&#129352;", "&#129353;"][index]
			: `#${index + 1}`;
		const formattedPoints = Number(team.points || 0).toLocaleString();
		const pointDigits = formattedPoints.replace(/\D/g, "").length;
		const pointSizeClass = pointDigits >= 5
			? "leaderboard-points-compact"
			: pointDigits >= 4
			? "leaderboard-points-small"
			: "";
		const rowClass = "hover:bg-slate-50 transition-colors";
		const row = document.createElement("tr");
		row.className = `leaderboard-moving-row cursor-pointer ${rowClass}`;
		row.dataset.teamKey = team.id
			? `id:${team.id}`
			: `name:${normalizeText(team.team)}`;
		row.dataset.rank = String(index + 1);
		row.innerHTML = `
		<td class="py-5 px-6">
		<div class="flex items-center">
		<span class="${index < 3 ? 'text-3xl leading-none' : 'text-sm font-black text-slate-700'}">${rankLabel}</span>
		</div>
		</td>
		<td class="py-5 px-6">
		<span class="font-bold text-slate-900">${escapeHTML(team.team)}</span>
		</td>
		<td class="py-5 px-6 text-center">
		<span class="leaderboard-points-badge inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 font-black text-sm">
		<span class="leaderboard-points-value ${pointSizeClass}">${formattedPoints}</span>
		</span>
		</td>
		<td class="py-5 px-6 text-center font-bold text-emerald-600">${Number(team.wins || 0)}</td>
		<td class="py-5 px-6 text-center font-bold text-red-500">${Number(team.losses || 0)}</td>
		`;
		if (onTeamClick) {
			row.onclick = () => onTeamClick(team);
		}
		tbody.appendChild(row);
	});

	animateLeaderboardRows(tbody, previousPositions, previousRanks);
}

// --- Rank-change animation ---------------------------------------------------

export function animateLeaderboardRows(tableBody, previousPositions, previousRanks) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	[...tableBody.querySelectorAll("tr[data-team-key]")].forEach(row => {
		const previousTop = previousPositions.get(row.dataset.teamKey);
		if (previousTop === undefined) return;
		const offset = previousTop - row.getBoundingClientRect().top;
		if (!offset) return;
		const previousRank = previousRanks.get(row.dataset.teamKey);
		const currentRank = Number(row.dataset.rank);
		row.classList.add(previousRank > currentRank ? "leaderboard-rank-up" : "leaderboard-rank-down");
		row.animate([
			{ transform: `translateY(${offset}px)` },
			{ transform: "translateY(0)" }
		], {
			duration: 4500,
			easing: "linear"
		});
	});
}
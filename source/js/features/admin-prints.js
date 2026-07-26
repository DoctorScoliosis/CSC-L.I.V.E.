/*
 * Printable reports for the Admin dashboard (Prints tab).
 *
 * Generates print-window reports from the game_history, attendance, and
 * scheduled_matches tables, plus the team/committee dropdowns used to pick
 * what to print. renderPrintTeamOptions and renderPrintCommitteeOptions are
 * also called by admin-teams.js, admin-participants.js, and
 * admin-accounts.js to keep those dropdowns in sync.
 */

import {
	state,
	dom,
	supabase,
	GAME_HISTORY_TABLE,
	ATTENDANCE_TABLE,
	MATCHES_TABLE
} from "../pages/admin-context.js";
import { formatDateTime } from "../utils/datetime.js";
import { getAccountRoleLabel } from "../pages/admin-helpers.js";

function normalizeText(value) {
	return String(value || "").trim().toLowerCase();
}

function toNumber(value) {
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : 0;
}

function getTeamNameOptions() {
	const teamNames = new Set();
	state.teamsData.forEach(team => {
		const teamName = String(team?.team || "").trim();
		if (teamName) teamNames.add(teamName);
	});
	state.participantsData.forEach(participant => {
		const teamName = String(participant.team || "").trim();
		if (teamName) teamNames.add(teamName);
	});
	return Array.from(teamNames).sort((a, b) => a.localeCompare(b));
}

export function renderPrintTeamOptions() {
	const teamNames = getTeamNameOptions();
	[dom.printCollegeHistoryTeam, dom.printCollegePointsTeam].forEach(select => {
		if (!select) return;
		const currentValue = select.value;
		select.innerHTML = '<option value="">Select college/team</option>';
		teamNames.forEach(teamName => {
			const option = document.createElement("option");
			option.value = teamName;
			option.textContent = teamName;
			select.appendChild(option);
		});
		if (teamNames.includes(currentValue)) {
			select.value = currentValue;
		}
	});
}

export function renderPrintCommitteeOptions() {
	if (!dom.printCommitteeAccount) return;
	const currentValue = dom.printCommitteeAccount.value;
	const accounts = state.accountApprovalsData
		.filter(account => {
			const role = String(account.role || "").trim().toLowerCase();
			return role === "committee" || role === "admin";
		})
		.sort((a, b) => String(a.full_name || a.email || "").localeCompare(String(b.full_name || b.email || "")));
	dom.printCommitteeAccount.innerHTML = '<option value="">Select committee account</option>';
	accounts.forEach(account => {
		const creatorKey = String(account.id || account.email || "").trim();
		if (!creatorKey) return;
		const option = document.createElement("option");
		option.value = creatorKey;
		option.dataset.email = account.email || "";
		option.dataset.name = account.full_name || account.email || "";
		option.textContent = `${account.full_name || account.email || "Unnamed account"} (${getAccountRoleLabel(account.role)})`;
		dom.printCommitteeAccount.appendChild(option);
	});
	if ([...dom.printCommitteeAccount.options].some(option => option.value === currentValue)) {
		dom.printCommitteeAccount.value = currentValue;
	}
}

function getHistorySportName(history) {
	return history.sport_name || history.game_name || history.category_name || history.sport || "Unknown Game";
}

function getHistoryDeclaredDay(history) {
	const value = history.declared_at || history.created_at || history.match_time;
	return value ? new Date(value).toLocaleDateString() : "-";
}

function getHistoryTeamName(history, side) {
	return side === "winner"
		? (history.winner_team_name || history.winner_name || "Winner")
		: (history.loser_team_name || history.loser_name || "Loser");
}

function getHistoryPointsForTeam(history, teamName) {
	const normalizedTeam = normalizeText(teamName);
	const winnerName = normalizeText(getHistoryTeamName(history, "winner"));
	const loserName = normalizeText(getHistoryTeamName(history, "loser"));
	if (winnerName === normalizedTeam) {
		return toNumber(history.winner_points_awarded || history.winner_award || history.winner_points || history.points_winner);
	}
	if (loserName === normalizedTeam) {
		return toNumber(history.loser_points_awarded || history.loser_award || history.loser_points || history.points_loser);
	}
	return 0;
}

function historyIncludesTeam(history, teamName) {
	const normalizedTeam = normalizeText(teamName);
	return normalizeText(getHistoryTeamName(history, "winner")) === normalizedTeam ||
		normalizeText(getHistoryTeamName(history, "loser")) === normalizedTeam;
}

function getHistoryOpponent(history, teamName) {
	const normalizedTeam = normalizeText(teamName);
	const winnerName = getHistoryTeamName(history, "winner");
	const loserName = getHistoryTeamName(history, "loser");
	if (normalizeText(winnerName) === normalizedTeam) {
		return loserName;
	}
	if (normalizeText(loserName) === normalizedTeam) {
		return winnerName;
	}
	return "-";
}

function getHistoryWinLoss(history, teamName) {
	const normalizedTeam = normalizeText(teamName);
	if (normalizeText(getHistoryTeamName(history, "winner")) === normalizedTeam) {
		return "Win";
	}
	if (normalizeText(getHistoryTeamName(history, "loser")) === normalizedTeam) {
		return "Lose";
	}
	return "-";
}

function getHistoryWinLossAgainstOpponent(history, teamName) {
	const result = getHistoryWinLoss(history, teamName);
	const opponent = getHistoryOpponent(history, teamName);
	return result === "-" ? "-" : `${result} vs ${opponent}`;
}

async function loadPrintGameHistory() {
	const { data, error } = await supabase
		.from(GAME_HISTORY_TABLE)
		.select("*")
		.order("match_time", { ascending: false });
	if (error) {
		console.error("Error loading printable game history:", error.message || error);
		alert("Failed to load game history for printing. Check the game_history table and policies.");
		return [];
	}
	return data || [];
}

function openPrintReport(title, subtitle, columns, rows) {
	const printWindow = window.open("", "_blank", "width=1100,height=760");
	if (!printWindow) {
		alert("Popup blocked. Please allow popups to print this report.");
		return;
	}
	const printDocument = printWindow.document;
	printDocument.title = title;
	printDocument.body.innerHTML = "";
	const style = printDocument.createElement("style");
	style.textContent = [
		"body { font-family: Arial, sans-serif; color: #111827; margin: 24px; }",
		"h1 { font-size: 22px; margin: 0 0 6px; }",
		"p { margin: 0 0 16px; color: #4b5563; font-size: 13px; }",
		"table { width: 100%; border-collapse: collapse; font-size: 12px; }",
		"th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }",
		"th { background: #f3f4f6; font-weight: 700; }",
		".empty { padding: 18px; text-align: center; color: #6b7280; }",
		".summary { font-weight: 700; color: #111827; }"
	].join("\n");
	printDocument.head.appendChild(style);
	const heading = printDocument.createElement("h1");
	heading.textContent = title;
	printDocument.body.appendChild(heading);
	const summary = printDocument.createElement("p");
	summary.textContent = `${subtitle} Generated ${new Date().toLocaleString()}.`;
	printDocument.body.appendChild(summary);
	const table = printDocument.createElement("table");
	const thead = printDocument.createElement("thead");
	const headerRow = printDocument.createElement("tr");
	columns.forEach(column => {
		const th = printDocument.createElement("th");
		th.textContent = column;
		headerRow.appendChild(th);
	});
	thead.appendChild(headerRow);
	table.appendChild(thead);
	const tbody = printDocument.createElement("tbody");
	if (rows.length === 0) {
		const row = printDocument.createElement("tr");
		const cell = printDocument.createElement("td");
		cell.colSpan = columns.length;
		cell.className = "empty";
		cell.textContent = "No records found.";
		row.appendChild(cell);
		tbody.appendChild(row);
	} else {
		rows.forEach(rowValues => {
			const row = printDocument.createElement("tr");
			rowValues.forEach(value => {
				const cell = printDocument.createElement("td");
				cell.textContent = value ?? "";
				row.appendChild(cell);
			});
			tbody.appendChild(row);
		});
	}
	table.appendChild(tbody);
	printDocument.body.appendChild(table);
	printDocument.close();
	printWindow.focus();
	printWindow.print();
}

export async function printBestPlayers() {
	const selectedDate = dom.printBestPlayersDate.value;
	if (!selectedDate) {
		alert("Please select a best player date.");
		return;
	}
	const historyRows = await loadPrintGameHistory();
	const rows = historyRows
		.filter(history => {
			const dateValue = history.match_time || history.created_at || history.declared_at;
			if (!String(history.best_player || "").trim() || !dateValue) {
				return false;
			}
			return new Date(dateValue).toLocaleDateString("en-CA") === selectedDate;
		})
		.sort((a, b) => {
			const gameCompare = getHistorySportName(a).localeCompare(getHistorySportName(b));
			if (gameCompare !== 0) return gameCompare;
			return new Date(a.match_time || a.created_at || 0) - new Date(b.match_time || b.created_at || 0);
		})
		.map(history => [
			getHistorySportName(history),
			history.best_player || "",
			`${getHistoryTeamName(history, "winner")} vs ${getHistoryTeamName(history, "loser")}`,
			formatDateTime(history.match_time || history.created_at)
		]);
	openPrintReport(
		`Best Player List - ${selectedDate}`,
		`Total best player records: ${rows.length}.`,
		["Game", "Best Player", "Match", "Date and Time"],
		rows
	);
}

export async function printCollegeHistory() {
	const teamName = dom.printCollegeHistoryTeam.value;
	if (!teamName) {
		alert("Please select a college/team.");
		return;
	}
	const historyRows = (await loadPrintGameHistory()).filter(history => historyIncludesTeam(history, teamName));
	const rows = historyRows.map(history => [
		getHistorySportName(history),
		getHistoryOpponent(history, teamName),
		getHistoryWinLoss(history, teamName),
		formatDateTime(history.match_time || history.created_at),
		history.best_player || "-"
	]);
	openPrintReport(
		`History of Games - ${teamName}`,
		`Total games: ${rows.length}.`,
		["Game", "Opponent", "Result", "Date and Time", "Best Player"],
		rows
	);
}

export async function printCollegePoints() {
	const teamName = dom.printCollegePointsTeam.value;
	if (!teamName) {
		alert("Please select a college/team.");
		return;
	}
	const historyRows = (await loadPrintGameHistory()).filter(history => historyIncludesTeam(history, teamName));
	let totalPoints = 0;
	const rows = historyRows.map(history => {
		const points = getHistoryPointsForTeam(history, teamName);
		totalPoints += points;
		return [
			getHistorySportName(history),
			getHistoryOpponent(history, teamName),
			String(points),
			getHistoryWinLossAgainstOpponent(history, teamName),
			formatDateTime(history.match_time || history.created_at)
		];
	});
	openPrintReport(
		`Points per College - ${teamName}`,
		`Total points: ${totalPoints}. Records: ${rows.length}.`,
		["Game", "Opponent", "Points", "Result", "Date and Time"],
		rows
	);
}

export async function printAttendanceByDate() {
	const selectedDate = dom.printAttendanceDate.value;
	if (!selectedDate) {
		alert("Please select an attendance date.");
		return;
	}
	const { data, error } = await supabase
		.from(ATTENDANCE_TABLE)
		.select("participant_name, student_id, team, status, attendance_date, checked_at")
		.eq("attendance_date", selectedDate)
		.order("checked_at", { ascending: true });
	if (error) {
		console.error("Error loading attendance print list:", error.message || error);
		alert("Failed to load attendance list. Check the attendance table and policies.");
		return;
	}
	const rows = (data || [])
		.sort((a, b) => {
			const teamCompare = String(a.team || "").localeCompare(String(b.team || ""));
			if (teamCompare !== 0) return teamCompare;
			return String(a.participant_name || "").localeCompare(String(b.participant_name || ""));
		})
		.map(item => [
			item.participant_name || "",
			item.student_id || "",
			item.team || "",
			item.status || "",
			formatDateTime(item.checked_at)
		]);
	openPrintReport(
		`Attendance List - ${selectedDate}`,
		`Total attendance records: ${rows.length}.`,
		["Name", "Student ID", "College/Team", "Status", "Checked At"],
		rows
	);
}

export async function printCommitteeMatches() {
	const creatorKey = dom.printCommitteeAccount.value;
	const selectedDate = dom.printCommitteeMatchesDate.value;
	const selectedOption = dom.printCommitteeAccount.options[dom.printCommitteeAccount.selectedIndex];
	if (!creatorKey) {
		alert("Please select a committee account.");
		return;
	}
	const { data, error } = await supabase
		.from(MATCHES_TABLE)
		.select(`
		id,
		match_time,
		location,
		status,
		created_by,
		created_by_name,
		sport:sports!scheduled_matches_sport_id_fkey(id, sport_name),
		team_one:sports_leaderboard!scheduled_matches_team_one_fkey(team),
		team_two:sports_leaderboard!scheduled_matches_team_two_fkey(team)
		`)
		.order("match_time", { ascending: true });
	if (error) {
		console.error("Error loading committee-created matches:", error.message || error);
		alert("Failed to load matches. Check scheduled_matches policies.");
		return;
	}
	const accountName = selectedOption?.dataset?.name || selectedOption?.textContent || creatorKey;
	const accountEmail = selectedOption?.dataset?.email || "";
	const normalizedCreatorKey = normalizeText(creatorKey);
	const normalizedAccountName = normalizeText(accountName);
	const normalizedAccountEmail = normalizeText(accountEmail);
	const matches = (data || []).filter(match => {
		const createdBy = normalizeText(match.created_by);
		const createdByName = normalizeText(match.created_by_name);
		const creatorMatches = createdBy === normalizedCreatorKey ||
			createdBy === normalizedAccountEmail ||
			createdByName === normalizedAccountName;
		if (!creatorMatches) {
			return false;
		}
		if (!selectedDate) {
			return true;
		}
		if (!match.match_time) {
			return false;
		}
		return new Date(match.match_time).toLocaleDateString("en-CA") === selectedDate;
	});
	const rows = matches.map(match => [
		match.sport?.sport_name || "Unknown Game",
		`${match.team_one?.team || "Team 1"} vs ${match.team_two?.team || "Team 2"}`,
		formatDateTime(match.match_time),
		match.location || "-",
		match.status || "-",
		match.created_by_name || "-"
	]);
	openPrintReport(
		`Matches Created by ${accountName}`,
		`${selectedDate ? `Date: ${selectedDate}. ` : ""}Total matches: ${rows.length}.`,
		["Game", "Teams", "Date and Time", "Location", "Status", "Created By"],
		rows
	);
}
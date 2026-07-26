/*
 * Manage Teams tab for the Admin dashboard.
 *
 * CRUD for the sports_leaderboard ("teams") table. Member counts are derived
 * from the participants table. Deleting a team that still has participants
 * assigned is blocked.
 *
 * loadTeams also refreshes the participant team filters, the participant
 * modal team options, the print team options, and the sports table (slot
 * availability depends on team list) — those renderers live in their own
 * modules and are imported here.
 */

import {
	state,
	dom,
	supabase,
	TEAMS_TABLE,
	TEAM_NAME_COLUMN,
	PARTICIPANTS_TABLE,
	PARTICIPANT_TEAM_COLUMN
} from "./admin-context.js";
import { escapeHTML } from "../utils/dom.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";
import { loadAdminOverviewCounts } from "./admin-overview.js";
import { renderParticipantTeamFilter, renderParticipantTeamOptions } from "./admin-participants.js";
import { renderPrintTeamOptions } from "./admin-prints.js";
import { renderSports } from "./admin-sports.js";

async function getParticipantCount(teamName) {
	const { count, error } = await supabase
		.from(PARTICIPANTS_TABLE)
		.select("*", { count: "exact", head: true })
		.eq(PARTICIPANT_TEAM_COLUMN, teamName);
	if (error) {
		console.error("Error counting participants:", error.message || error);
		return 0;
	}
	return count || 0;
}

export function openAddTeamModal() {
	dom.teamModalTitle.textContent = "Add New Team";
	dom.teamForm.reset();
	dom.teamId.value = "";
	dom.teamModal.classList.remove("hidden");
	dom.teamModal.classList.add("flex");
}

export function openEditTeamModal(team) {
	dom.teamModalTitle.textContent = "Edit Team";
	dom.teamId.value = team.id;
	dom.teamNameInput.value = team[TEAM_NAME_COLUMN];
	dom.teamModal.classList.remove("hidden");
	dom.teamModal.classList.add("flex");
}

export function closeTeamModalFunction() {
	dom.teamModal.classList.add("hidden");
	dom.teamModal.classList.remove("flex");
	dom.teamForm.reset();
	dom.teamId.value = "";
}

export async function loadTeams() {
	const { data, error } = await supabase
		.from(TEAMS_TABLE)
		.select(`id, ${TEAM_NAME_COLUMN}`)
		.order(TEAM_NAME_COLUMN, { ascending: true });
	if (error) {
		console.error("Error loading teams:", error.message || error);
		dom.teamsTableBody.innerHTML = `
		<tr>
		<td colspan="3" class="py-4 px-4 text-red-600">
		Error loading teams. Check your Supabase table and RLS policies.
		</td>
		</tr>
		`;
		return;
	}
	state.teamsData = await Promise.all(
		(data || []).map(async teamRow => {
			const membersCount = await getParticipantCount(teamRow[TEAM_NAME_COLUMN]);
			return {
				...teamRow,
				membersCount
			};
		})
	);
	renderTeams();
	renderParticipantTeamFilter();
	renderParticipantTeamOptions();
	renderPrintTeamOptions();
	if (state.sportsData.length > 0) {
		renderSports();
	}
}

export function renderTeams() {
	dom.teamsTableBody.innerHTML = "";
	if (state.teamsData.length === 0) {
		dom.teamsTableBody.innerHTML = `
		<tr>
		<td colspan="3" class="py-4 px-4 text-gray-600">
		No teams added yet.
		</td>
		</tr>
		`;
		return;
	}
	state.teamsData.forEach(team => {
		const row = document.createElement("tr");
		row.className = "border-b border-gray-100 hover:bg-gray-50";
		row.innerHTML = `
		<td class="py-3 px-4 font-medium text-gray-900">
		${escapeHTML(team[TEAM_NAME_COLUMN])}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${team.membersCount}
		</td>
		<td class="py-3 px-4 space-x-2">
		<button
		type="button"
		data-team-id="${team.id}"
		class="edit-team-btn text-blue-600 hover:text-blue-700 font-medium text-sm">
		Edit
		</button>
		<button
		type="button"
		data-team-id="${team.id}"
		class="delete-team-btn text-red-600 hover:text-red-700 font-medium text-sm">
		Delete
		</button>
		</td>
		`;
		dom.teamsTableBody.appendChild(row);
	});
	document.querySelectorAll(".edit-team-btn").forEach(button => {
		button.addEventListener("click", function () {
			const selectedTeam = state.teamsData.find(team => {
				return Number(team.id) === Number(this.dataset.teamId);
			});
			if (selectedTeam) {
				openEditTeamModal(selectedTeam);
			}
		});
	});
	document.querySelectorAll(".delete-team-btn").forEach(button => {
		button.addEventListener("click", function () {
			deleteTeam(this.dataset.teamId);
		});
	});
}

export async function deleteTeam(id) {
	const selectedTeam = state.teamsData.find(team => Number(team.id) === Number(id));
	if (selectedTeam && selectedTeam.membersCount > 0) {
		showDashboardToast("You cannot delete this team because it still has participants assigned.", "warning");
		return;
	}
	const confirmDelete = await showDashboardConfirm("Are you sure you want to delete this team?", {
		title: "Delete Team",
		confirmText: "Delete Team"
	});
	if (!confirmDelete) {
		return;
	}
	const { error } = await supabase
		.from(TEAMS_TABLE)
		.delete()
		.eq("id", id);
	if (error) {
		console.error("Error deleting team:", error.message || error);
		alert("Error deleting team. It may be connected to scheduled matches.");
		return;
	}
	showDashboardToast("Team deleted successfully!");
	await Promise.all([
		loadTeams(),
		loadAdminOverviewCounts()
	]);
}

export async function saveTeam(event) {
	event.preventDefault();
	const teamName = dom.teamNameInput.value.trim();
	if (!teamName) {
		alert("Please enter a team name.");
		return;
	}
	const teamData = {
		[TEAM_NAME_COLUMN]: teamName
	};
	let result;
	if (dom.teamId.value) {
		result = await supabase
			.from(TEAMS_TABLE)
			.update(teamData)
			.eq("id", dom.teamId.value);
	} else {
		result = await supabase
			.from(TEAMS_TABLE)
			.insert([teamData]);
	}
	if (result.error) {
		console.error("Error saving team:", result.error.message || result.error);
		alert("Error saving team. Check if the team already exists or if RLS allows insert/update.");
		return;
	}
	alert(dom.teamId.value ? "Team updated successfully!" : "Team added successfully!");
	closeTeamModalFunction();
	await Promise.all([
		loadTeams(),
		loadAdminOverviewCounts()
	]);
}
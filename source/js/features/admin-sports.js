/*
 * Manage Games tab for the Admin dashboard.
 *
 * CRUD for the sports table (game categories with a major/minor type and a
 * per-team player limit). The "Slots Available" column is derived from the
 * participant count per team via admin-participant-helpers.js.
 *
 * loadSports also refreshes the participant sport filter, the contact group
 * options, and the account approvals table (sport assignment labels depend on
 * the sports list) — those renderers live in their own modules.
 */

import { state, dom, supabase, SPORTS_TABLE } from "./admin-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";
import {
	normalizeGameType,
	getSportGameTypeLabel,
	getSportPlayerLimit
} from "./admin-helpers.js";
import { getSportTotalAvailableSlots } from "./admin-participant-helpers.js";
import { loadAdminOverviewCounts } from "./admin-overview.js";
import { renderParticipantSportFilter } from "./admin-participants.js";
import { populateAdminContactGroupOptions } from "./admin-chat.js";
import { renderAccountApprovals } from "./admin-accounts.js";

export function openAddSportModal() {
	dom.sportModalTitle.textContent = "Add New Sport";
	dom.sportForm.reset();
	dom.sportId.value = "";
	dom.sportGameTypeInput.value = "major";
	dom.sportPlayerLimitInput.value = "";
	dom.sportModal.classList.remove("hidden");
	dom.sportModal.classList.add("flex");
}

export function openEditSportModal(sport) {
	dom.sportModalTitle.textContent = "Edit Sport";
	dom.sportId.value = sport.id;
	dom.sportNameInput.value = sport.sport_name;
	dom.sportGameTypeInput.value = normalizeGameType(sport.game_type || sport.sport_type || sport.category_type);
	dom.sportPlayerLimitInput.value = getSportPlayerLimit(sport) || "";
	dom.sportModal.classList.remove("hidden");
	dom.sportModal.classList.add("flex");
}

export function closeSportModalFunction() {
	dom.sportModal.classList.add("hidden");
	dom.sportModal.classList.remove("flex");
	dom.sportForm.reset();
	dom.sportId.value = "";
	dom.sportPlayerLimitInput.value = "";
}

export async function loadSports() {
	const { data, error } = await supabase
		.from(SPORTS_TABLE)
		.select("id, sport_name, game_type, player_limit, created_at, updated_at")
		.order("sport_name", { ascending: true });
	if (error) {
		console.error("Error loading sports:", error.message || error);
		dom.sportsTableBody.innerHTML = `
		<tr>
		<td colspan="6" class="py-4 px-4 text-red-600">
		Error loading sports. Run the SQL below first, then check your Supabase RLS policies.
		</td>
		</tr>
		`;
		return;
	}
	state.sportsData = data || [];
	renderSports();
	renderParticipantSportFilter();
	populateAdminContactGroupOptions();
	if (state.accountApprovalsData.length > 0) {
		renderAccountApprovals();
	}
}

export function renderSports() {
	dom.sportsTableBody.innerHTML = "";
	if (state.sportsData.length === 0) {
		dom.sportsTableBody.innerHTML = `
		<tr>
		<td colspan="6" class="py-4 px-4 text-gray-600">
		No sports added yet.
		</td>
		</tr>
		`;
		return;
	}
	state.sportsData.forEach(sport => {
		const row = document.createElement("tr");
		row.className = "border-b border-gray-100 hover:bg-gray-50";
		const playerLimit = getSportPlayerLimit(sport);
		const availableSlots = getSportTotalAvailableSlots(sport);
		row.innerHTML = `
		<td class="py-3 px-4 font-medium text-gray-900">
		${escapeHTML(sport.sport_name)}
		</td>
		<td class="py-3 px-4 text-gray-600">
		<span class="inline-flex rounded-full px-3 py-1 text-xs font-bold ${normalizeGameType(sport.game_type) === "minor" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}">
		${escapeHTML(getSportGameTypeLabel(sport.game_type))}
		</span>
		</td>
		<td class="py-3 px-4 text-gray-600">
		${playerLimit ? escapeHTML(playerLimit) : `<span class="text-red-600 font-semibold">Not set</span>`}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${availableSlots === null ? "-" : escapeHTML(availableSlots)}
		</td>
		<td class="py-3 px-4 text-gray-600">
		${escapeHTML(formatDateTime(sport.updated_at))}
		</td>
		<td class="py-3 px-4 space-x-2">
		<button
		type="button"
		data-sport-id="${sport.id}"
		class="edit-sport-btn text-blue-600 hover:text-blue-700 font-medium text-sm">
		Edit
		</button>
		<button
		type="button"
		data-sport-id="${sport.id}"
		class="view-sport-btn text-gray-600 hover:text-gray-800 font-medium text-sm">
		View
		</button>
		<button
		type="button"
		data-sport-id="${sport.id}"
		class="delete-sport-btn text-red-600 hover:text-red-700 font-medium text-sm">
		Delete
		</button>
		</td>
		`;
		dom.sportsTableBody.appendChild(row);
	});
	document.querySelectorAll(".edit-sport-btn").forEach(button => {
		button.addEventListener("click", function () {
			const selectedSport = state.sportsData.find(sport => {
				return Number(sport.id) === Number(this.dataset.sportId);
			});
			if (selectedSport) {
				openEditSportModal(selectedSport);
			}
		});
	});
	document.querySelectorAll(".view-sport-btn").forEach(button => {
		button.addEventListener("click", function () {
			const selectedSport = state.sportsData.find(sport => {
				return Number(sport.id) === Number(this.dataset.sportId);
			});
			if (!selectedSport) {
				return;
			}
			alert(
				`Sport: ${selectedSport.sport_name}\n` +
				`Type: ${getSportGameTypeLabel(selectedSport.game_type)}\n` +
				`Players per team: ${getSportPlayerLimit(selectedSport) || "Not set"}\n` +
				`Total slots available: ${getSportTotalAvailableSlots(selectedSport) ?? "-"}`
			);
		});
	});
	document.querySelectorAll(".delete-sport-btn").forEach(button => {
		button.addEventListener("click", function () {
			deleteSport(this.dataset.sportId);
		});
	});
}

export async function saveSport(event) {
	event.preventDefault();
	const sportName = dom.sportNameInput.value.trim();
	const gameType = normalizeGameType(dom.sportGameTypeInput.value);
	const playerLimit = dom.sportPlayerLimitInput.value ? Number(dom.sportPlayerLimitInput.value) : null;
	if (!sportName) {
		alert("Please enter a sport name.");
		return;
	}
	if (!Number.isInteger(playerLimit) || playerLimit < 1) {
		alert("Please enter the number of players allowed per team for this sport category.");
		dom.sportPlayerLimitInput.focus();
		return;
	}
	const sportData = {
		sport_name: sportName,
		game_type: gameType,
		player_limit: playerLimit
	};
	let result;
	if (dom.sportId.value) {
		result = await supabase
			.from(SPORTS_TABLE)
			.update(sportData)
			.eq("id", dom.sportId.value);
	} else {
		result = await supabase
			.from(SPORTS_TABLE)
			.insert([sportData]);
	}
	if (result.error) {
		console.error("Error saving sport:", result.error.message || result.error);
		alert("Error saving sport. Check if the sport already exists or if RLS allows insert/update.");
		return;
	}
	closeSportModalFunction();
	await Promise.all([
		loadSports(),
		loadAdminOverviewCounts()
	]);
}

export async function deleteSport(id) {
	const confirmDelete = await showDashboardConfirm("Are you sure you want to delete this sport?", {
		title: "Delete Sport",
		confirmText: "Delete Sport"
	});
	if (!confirmDelete) {
		return;
	}
	const { error } = await supabase
		.from(SPORTS_TABLE)
		.delete()
		.eq("id", id);
	if (error) {
		console.error("Error deleting sport:", error.message || error);
		alert("Error deleting sport. Check if it is connected to other records.");
		return;
	}
	showDashboardToast("Sport deleted successfully!");
	await Promise.all([
		loadSports(),
		loadAdminOverviewCounts()
	]);
}
/*
 * Contact directory for the admin Communications tab.
 *
 * Renders the contact list grouped by sport/admin, the group selector,
 * the search filter, and loads the contact profiles from user_profiles.
 */

import { state, dom, supabase } from "../pages/admin-context.js";
import { normalizeComparableValue } from "../pages/admin-helpers.js";
import { escapeHTML } from "../utils/dom.js";
import {
	getProfileDisplayName,
	getProfileSportName,
	getProfilePhone,
	getInitials,
	getRoleBadgeClass,
	getContactSportGroups,
	getContactSportGroupKey,
	getCurrentContactUserId
} from "./admin-chat-helpers.js";

export function getSelectedContactsSportName() {
	if (!state.activeContactSportId) {
		return "No contact group selected";
	}
	if (state.activeContactSportId === "__admin__") {
		return "Admin";
	}
	const selectedGroup = getContactSportGroups().find(group => String(group.id) === String(state.activeContactSportId));
	return selectedGroup?.sport_name || "Selected sport";
}

export function updateContactsSportSummary() {
	if (dom.contactsSportSummary) {
		dom.contactsSportSummary.textContent = state.activeContactSportId
			? `Showing contacts for ${getSelectedContactsSportName()}.`
			: "Choose who to contact first.";
	}
}

export function populateContactsSportOptions(sports) {
	if (!dom.contactsSportSelect) {
		return;
	}
	const previousValue = state.activeContactSportId;
	dom.contactsSportSelect.innerHTML = `
	<option value="">Choose sport or admin</option>
	<option value="__admin__">Admin</option>
	`;
	getContactSportGroups(sports).forEach(sport => {
		const option = document.createElement("option");
		option.value = sport.id;
		option.textContent = sport.sport_name || "Unnamed sport";
		dom.contactsSportSelect.appendChild(option);
	});
	const stillExists = !previousValue
		|| previousValue === "__admin__"
		|| getContactSportGroups(sports).some(sport => String(sport.id) === String(previousValue));
	state.activeContactSportId = stillExists ? previousValue : "";
	dom.contactsSportSelect.value = state.activeContactSportId;
	updateContactsSportSummary();
}

export function getContactsForSport(sportId) {
	if (!sportId) {
		return [];
	}
	if (sportId === "__admin__") {
		return state.contactPersonnelData.filter(profile =>
			normalizeComparableValue(profile.role) === "admin"
		);
	}
	const selectedGroup = getContactSportGroups().find(group => String(group.id) === String(sportId));
	const selectedGroupKey = getContactSportGroupKey({ role: "committee", assigned_sport_name: selectedGroup?.sport_name || sportId });
	return state.contactPersonnelData.filter(profile =>
		normalizeComparableValue(profile.role) !== "admin"
		&& getContactSportGroupKey(profile) === selectedGroupKey
	);
}

export function getFilteredVisibleContacts() {
	const visibleContacts = getContactsForSport(state.activeContactSportId);
	const searchTerm = state.activeContactSearchTerm.trim().toLowerCase();
	if (!searchTerm) {
		return visibleContacts;
	}
	return visibleContacts.filter(profile => {
		const haystack = [
			getProfileDisplayName(profile),
			getProfileSportName(profile),
			getRoleLabel(profile.role)
		].join(" ").toLowerCase();
		return haystack.includes(searchTerm);
	});
}

export function setContactsVisible(isVisible) {
	dom.contactsSection?.classList.toggle("hidden", !isVisible);
}

export function renderContactsList() {
	if (!dom.contactsList) {
		return;
	}
	updateContactsSportSummary();
	if (!state.activeContactSportId) {
		dom.contactsList.innerHTML = `
		<div class="rounded-xl bg-white p-4 text-sm font-semibold text-gray-500 shadow-sm">
		Choose a sport group or Admin first to see who you can contact.
		</div>
		`;
		return;
	}
	const visibleContacts = getFilteredVisibleContacts();
	if (visibleContacts.length === 0) {
		dom.contactsList.innerHTML = `
		<div class="rounded-xl bg-white p-4 text-sm font-semibold text-gray-500 shadow-sm">
		No contacts found for ${escapeHTML(getSelectedContactsSportName())}.
		</div>
		`;
		return;
	}
	dom.contactsList.innerHTML = visibleContacts.map(profile => {
		const profileName = getProfileDisplayName(profile);
		const sportName = getProfileSportName(profile);
		const phone = getProfilePhone(profile);
		const isSelf = String(profile.id) === String(getCurrentContactUserId());
		const isActive = String(state.activeContactProfile?.id || "") === String(profile.id);
		const roleLabel = getRoleLabel(profile.role);
		return `
		<button
		type="button"
		data-contact-id="${escapeHTML(profile.id)}"
		${isSelf ? "disabled" : ""}
		class="contact-row flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${isSelf ? "cursor-not-allowed opacity-60" : "hover:bg-white hover:shadow-sm"} ${isActive ? "bg-white shadow-sm ring-2 ring-blue-200" : "bg-transparent"}">
		<span class="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
		${escapeHTML(getInitials(profileName))}
		<span class="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500"></span>
		</span>
		<span class="min-w-0 flex-1">
		<span class="flex items-center justify-between gap-2">
		<span class="truncate font-bold text-gray-900">${escapeHTML(profileName)}${isSelf ? " (You)" : ""}</span>
		<span class="text-[11px] font-semibold text-gray-400">${phone ? "Call" : ""}</span>
		</span>
		<span class="mt-1 flex items-center gap-2">
		<span class="rounded-full px-2 py-0.5 text-[11px] font-bold ${getRoleBadgeClass(profile.role)}">${escapeHTML(roleLabel)}</span>
		<span class="truncate text-xs font-semibold text-gray-500">${escapeHTML(sportName)}</span>
		</span>
		<span class="mt-1 block truncate text-xs text-gray-500">Tap to open conversation</span>
		</span>
		</button>
		`;
	}).join("");
	document.querySelectorAll(".contact-row").forEach(row => {
		row.addEventListener("click", async function () {
			const selectedProfile = state.contactPersonnelData.find(profile => String(profile.id) === String(this.dataset.contactId));
			if (selectedProfile && String(selectedProfile.id) !== String(getCurrentContactUserId())) {
				setContactsVisible(false);
				// openContactConversation is wired by the orchestrator to avoid a
				// contacts -> thread import; see admin.js.
				if (typeof window.openAdminContactConversationFromList === "function") {
					await window.openAdminContactConversationFromList(selectedProfile);
				}
			}
		});
	});
}

export async function loadContactPersonnel() {
	if (!dom.contactsList) {
		return;
	}
	const { data, error } = await supabase
		.from("user_profiles")
		.select("*")
		.in("role", ["committee", "admin"])
		.eq("approval_status", "approved")
		.order("full_name", { ascending: true });
	if (error) {
		console.error("Error loading admin communication contacts:", error.message || error);
		dom.contactsList.innerHTML = `
		<div class="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">
		Failed to load contacts. Run the Contacts SQL and check user profile policies.
		</div>
		`;
		return;
	}
	state.contactPersonnelData = data || [];
	renderContactsList();
	// renderCommitteeConversationList is wired by the orchestrator to avoid a
	// contacts -> thread import.
	if (typeof window.renderAdminConversationListFromContacts === "function") {
		window.renderAdminConversationListFromContacts();
	}
}

// Local copy so this module stays a leaf (no admin-helpers role import needed).
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
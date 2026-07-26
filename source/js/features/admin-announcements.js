/*
 * Announcements tab for the Admin dashboard.
 *
 * CRUD for the announcements table. Each announcement targets an audience
 * (all / students / committee) and can be toggled active/hidden. Active
 * announcements surface as popups on the student and committee dashboards.
 */

import { state, dom, supabase, ANNOUNCEMENTS_TABLE } from "../pages/admin-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";

export async function loadAnnouncements() {
	if (!dom.adminAnnouncementsList) return;
	const { data, error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.select("*")
		.order("created_at", { ascending: false });
	if (error) {
		console.error("Error loading announcements:", error.message || error);
		dom.adminAnnouncementsList.innerHTML = `
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
		Failed to load announcements. Check the announcements table and policies.
		</div>
		`;
		return;
	}
	state.announcementsData = data || [];
	renderAnnouncements();
}

export function refreshAdminAnnouncementsRealtime() {
	loadAnnouncements();
}

export function renderAnnouncements() {
	if (!dom.adminAnnouncementsList) return;
	if (state.announcementsData.length === 0) {
		dom.adminAnnouncementsList.innerHTML = `
		<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600">
		No announcements posted yet.
		</div>
		`;
		return;
	}
	dom.adminAnnouncementsList.innerHTML = state.announcementsData.map(item => `
	<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
	<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
	<div>
	<div class="flex flex-wrap items-center gap-2 mb-2">
	<span class="inline-flex rounded-full px-3 py-1 text-xs font-bold ${item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}">
	${item.is_active ? "Active" : "Hidden"}
	</span>
	<span class="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
	${escapeHTML(getAnnouncementAudienceLabel(item.audience))}
	</span>
	<span class="text-xs font-semibold text-gray-500">${formatDateTime(item.created_at)}</span>
	</div>
	<h3 class="text-lg font-bold text-gray-900">${escapeHTML(item.title)}</h3>
	<p class="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-800">${escapeHTML(item.message)}</p>
	</div>
	<div class="flex shrink-0 flex-col gap-2 sm:flex-row">
	<button type="button" data-announcement-id="${item.id}" class="edit-announcement-btn rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
	Edit
	</button>
	<button type="button" data-announcement-id="${item.id}" data-announcement-active="${item.is_active ? "false" : "true"}" class="toggle-announcement-btn rounded-lg px-3 py-2 text-sm font-semibold ${item.is_active ? "bg-gray-200 text-gray-700 hover:bg-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"}">
	${item.is_active ? "Hide" : "Show"}
	</button>
	<button type="button" data-announcement-id="${item.id}" class="delete-announcement-btn rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700">
	Delete
	</button>
	</div>
	</div>
	</div>
	`).join("");
	document.querySelectorAll(".toggle-announcement-btn").forEach(button => {
		button.addEventListener("click", () => toggleAnnouncement(button.dataset.announcementId, button.dataset.announcementActive === "true"));
	});
	document.querySelectorAll(".edit-announcement-btn").forEach(button => {
		button.addEventListener("click", () => openAnnouncementEditModal(button.dataset.announcementId));
	});
	document.querySelectorAll(".delete-announcement-btn").forEach(button => {
		button.addEventListener("click", () => deleteAnnouncement(button.dataset.announcementId));
	});
}

function getAnnouncementAudienceLabel(audience) {
	if (audience === "students") return "Students only";
	if (audience === "committee") return "Committee only";
	return "Students and Committee";
}

export async function saveAnnouncement(event) {
	event.preventDefault();
	const title = dom.announcementTitle.value.trim();
	const message = dom.announcementMessage.value.trim();
	if (!title || !message) {
		dom.announcementStatus.textContent = "Please complete the title and message.";
		dom.announcementStatus.className = "text-sm font-semibold text-red-600";
		return;
	}
	dom.saveAnnouncementButton.disabled = true;
	dom.saveAnnouncementButton.textContent = "Publishing...";
	const { error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.insert([{
			title,
			message,
			audience: dom.announcementAudience.value,
			is_active: dom.announcementActive.checked
		}]);
	dom.saveAnnouncementButton.disabled = false;
	dom.saveAnnouncementButton.textContent = "Publish Announcement";
	if (error) {
		console.error("Error saving announcement:", error.message || error);
		dom.announcementStatus.textContent = "Failed to publish announcement.";
		dom.announcementStatus.className = "text-sm font-semibold text-red-600";
		return;
	}
	dom.announcementForm.reset();
	dom.announcementAudience.value = "all";
	dom.announcementActive.checked = true;
	dom.announcementStatus.textContent = "Announcement published.";
	dom.announcementStatus.className = "text-sm font-semibold text-emerald-700";
	await loadAnnouncements();
}

export function openAnnouncementEditModal(id) {
	const announcement = state.announcementsData.find(item => String(item.id) === String(id));
	if (!announcement) {
		alert("Announcement not found.");
		return;
	}
	dom.announcementEditId.value = announcement.id;
	dom.announcementEditTitle.value = announcement.title || "";
	dom.announcementEditMessage.value = announcement.message || "";
	dom.announcementEditAudience.value = announcement.audience || "all";
	dom.announcementEditActive.checked = Boolean(announcement.is_active);
	dom.saveAnnouncementEditButton.disabled = false;
	dom.saveAnnouncementEditButton.textContent = "Save Changes";
	dom.announcementEditModal.classList.remove("hidden");
	dom.announcementEditModal.classList.add("flex");
}

export function closeAnnouncementEditModalFunction() {
	dom.announcementEditModal.classList.add("hidden");
	dom.announcementEditModal.classList.remove("flex");
	dom.announcementEditForm.reset();
	dom.announcementEditId.value = "";
}

export async function saveAnnouncementEdit(event) {
	event.preventDefault();
	const id = dom.announcementEditId.value;
	const title = dom.announcementEditTitle.value.trim();
	const message = dom.announcementEditMessage.value.trim();
	if (!id || !title || !message) {
		alert("Please complete the announcement title and message.");
		return;
	}
	dom.saveAnnouncementEditButton.disabled = true;
	dom.saveAnnouncementEditButton.textContent = "Saving...";
	const { error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.update({
			title,
			message,
			audience: dom.announcementEditAudience.value,
			is_active: dom.announcementEditActive.checked
		})
		.eq("id", id);
	dom.saveAnnouncementEditButton.disabled = false;
	dom.saveAnnouncementEditButton.textContent = "Save Changes";
	if (error) {
		console.error("Error updating announcement:", error.message || error);
		alert("Failed to update announcement. Check announcements update policies.");
		return;
	}
	closeAnnouncementEditModalFunction();
	await loadAnnouncements();
}

export async function toggleAnnouncement(id, isActive) {
	const { error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.update({ is_active: isActive })
		.eq("id", id);
	if (error) {
		console.error("Error updating announcement:", error.message || error);
		alert("Failed to update announcement.");
		return;
	}
	await loadAnnouncements();
}

export async function deleteAnnouncement(id) {
	const confirmDelete = await showDashboardConfirm("Delete this announcement?", {
		title: "Delete Announcement",
		confirmText: "Delete"
	});
	if (!confirmDelete) {
		return;
	}
	const { error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.delete()
		.eq("id", id);
	if (error) {
		console.error("Error deleting announcement:", error.message || error);
		alert("Failed to delete announcement.");
		return;
	}
	await loadAnnouncements();
	showDashboardToast("Announcement deleted.");
}
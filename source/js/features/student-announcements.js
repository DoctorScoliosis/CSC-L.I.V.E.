/*
 * Announcement handling for the Student dashboard.
 *
 * Owns the announcement popup (shown once per new/updated announcement),
 * the unread badge, the all-announcements modal, and the realtime change
 * handler. Announcement "seen" state is persisted in localStorage so a
 * returning student is not re-shown old popups.
 */

import {
	supabase,
	state,
	dom,
	ANNOUNCEMENTS_TABLE,
	STUDENT_SEEN_ANNOUNCEMENTS_KEY
} from "../pages/student-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTimeShort as formatDateTime } from "../utils/datetime.js";

export function getAnnouncementSeenKey(announcement) {
	return [
		announcement?.id,
		announcement?.updated_at || announcement?.created_at || "",
		announcement?.title || "",
		announcement?.message || "",
		announcement?.audience || "",
		announcement?.is_active ? "active" : "hidden"
	].map(value => String(value ?? "")).join("|");
}

export function openStudentAnnouncement(announcement) {
	const announcementKey = getAnnouncementSeenKey(announcement);
	if (!announcement || announcementKey === state.lastShownAnnouncementKey) return;
	state.lastShownAnnouncementKey = announcementKey;
	dom.studentAnnouncementDate.textContent = formatDateTime(announcement.created_at);
	dom.studentAnnouncementTitle.textContent = announcement.title || "Announcement";
	dom.studentAnnouncementMessage.textContent = announcement.message || "";
	dom.studentAnnouncementModal.classList.remove("hidden");
	dom.studentAnnouncementModal.classList.add("flex");
}

export function closeAnnouncementModal() {
	dom.studentAnnouncementModal.classList.add("hidden");
	dom.studentAnnouncementModal.classList.remove("flex");
}

function getSeenAnnouncementKeys() {
	try {
		const parsed = JSON.parse(localStorage.getItem(STUDENT_SEEN_ANNOUNCEMENTS_KEY) || "[]");
		return Array.isArray(parsed) ? parsed.map(key => String(key)) : [];
	} catch (error) {
		return [];
	}
}

function saveSeenAnnouncementKeys(keys) {
	localStorage.setItem(STUDENT_SEEN_ANNOUNCEMENTS_KEY, JSON.stringify([...new Set(keys.map(key => String(key)))]));
}

export function updateAnnouncementBadge() {
	if (!dom.studentAnnouncementCount) return;
	const seenKeys = new Set(getSeenAnnouncementKeys());
	const unreadKeys = new Set([
		...state.studentAnnouncementsData
			.filter(item => !seenKeys.has(getAnnouncementSeenKey(item)))
			.map(item => getAnnouncementSeenKey(item)),
		...state.studentAnnouncementChanges.keys()
	]);
	const newCount = unreadKeys.size;
	dom.studentAnnouncementCount.textContent = String(newCount);
	dom.studentAnnouncementCount.classList.toggle("hidden", newCount === 0);
}

export function markCurrentAnnouncementsSeen() {
	saveSeenAnnouncementKeys([
		...getSeenAnnouncementKeys(),
		...state.studentAnnouncementsData.map(item => getAnnouncementSeenKey(item))
	]);
	state.studentAnnouncementChanges.clear();
	updateAnnouncementBadge();
}

export function isNotificationsModalOpen() {
	return dom.studentNotificationsModal && !dom.studentNotificationsModal.classList.contains("hidden");
}

export function openNotificationsModal() {
	renderStudentNotifications();
	markCurrentAnnouncementsSeen();
	dom.studentNotificationsModal.classList.remove("hidden");
	dom.studentNotificationsModal.classList.add("flex");
}

export function closeNotificationsModal() {
	dom.studentNotificationsModal.classList.add("hidden");
	dom.studentNotificationsModal.classList.remove("flex");
}

export function renderStudentNotifications() {
	if (!dom.studentNotificationsList) return;
	if (state.studentAnnouncementsData.length === 0 && state.studentAnnouncementChanges.size === 0) {
		dom.studentNotificationsList.innerHTML = `
		<div class="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-500">
		No announcements available.
		</div>
		`;
		return;
	}
	const visibleItems = state.studentAnnouncementsData.map(item => `
	<article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
	<p class="mb-2 text-xs font-black uppercase tracking-widest text-blue-700">${formatDateTime(item.created_at)}</p>
	<h3 class="text-lg font-black text-slate-950">${escapeHTML(item.title || "Announcement")}</h3>
	<p class="mt-3 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-700">${escapeHTML(item.message || "")}</p>
	</article>
	`);
	dom.studentNotificationsList.innerHTML = visibleItems.join("");
}

export async function loadStudentAnnouncements() {
	const { data, error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.select("*")
		.eq("is_active", true)
		.in("audience", ["all", "students"])
		.order("created_at", { ascending: false });
	if (error) {
		console.error("Student announcements list load error:", error.message || error);
		return;
	}
	state.studentAnnouncementsData = data || [];
	const visibleAnnouncementIds = new Set(state.studentAnnouncementsData.map(item => String(item.id)));
	[...state.studentAnnouncementChanges.entries()].forEach(([key, announcement]) => {
		if (!visibleAnnouncementIds.has(String(announcement.id))) {
			state.studentAnnouncementChanges.delete(key);
		}
	});
	updateAnnouncementBadge();
	renderStudentNotifications();
}

export async function refreshStudentAnnouncements({ showPopup = false } = {}) {
	if (state.isRefreshingStudentAnnouncements) {
		state.shouldRefreshStudentAnnouncementsAgain = true;
		state.shouldShowQueuedStudentAnnouncementPopup = state.shouldShowQueuedStudentAnnouncementPopup || Boolean(showPopup);
		return;
	}
	state.isRefreshingStudentAnnouncements = true;
	state.shouldRefreshStudentAnnouncementsAgain = false;
	state.shouldShowQueuedStudentAnnouncementPopup = false;
	try {
		await loadStudentAnnouncements();
		await loadLatestAnnouncement({ showPopup });
		if (isNotificationsModalOpen()) {
			renderStudentNotifications();
		}
	} finally {
		state.isRefreshingStudentAnnouncements = false;
		if (state.shouldRefreshStudentAnnouncementsAgain) {
			const showQueuedPopup = state.shouldShowQueuedStudentAnnouncementPopup;
			state.shouldRefreshStudentAnnouncementsAgain = false;
			state.shouldShowQueuedStudentAnnouncementPopup = false;
			await refreshStudentAnnouncements({ showPopup: showQueuedPopup });
		}
	}
}

export async function loadLatestAnnouncement({ showPopup = true } = {}) {
	const { data, error } = await supabase
		.from(ANNOUNCEMENTS_TABLE)
		.select("*")
		.eq("is_active", true)
		.in("audience", ["all", "students"])
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) {
		console.error("Student announcement load error:", error.message || error);
		return;
	}
	if (showPopup && data) {
		openStudentAnnouncement(data);
	}
}

function isStudentAnnouncementVisible(announcement) {
	return Boolean(announcement?.is_active)
		&& ["all", "students"].includes(String(announcement?.audience || ""));
}

function clearStudentAnnouncementNotifications(announcementId) {
	if (!announcementId) return;
	[...state.studentAnnouncementChanges.entries()].forEach(([key, announcement]) => {
		if (String(announcement.id) === String(announcementId)) {
			state.studentAnnouncementChanges.delete(key);
		}
	});
}

export function notifyStudentAnnouncementChange(payload) {
	const previous = payload.old;
	const next = payload.new;
	const wasVisible = isStudentAnnouncementVisible(previous);
	const isVisible = isStudentAnnouncementVisible(next);
	const contentChanged = Boolean(previous && next)
		&& (String(previous.title || "") !== String(next.title || "")
		|| String(previous.message || "") !== String(next.message || ""));
	clearStudentAnnouncementNotifications(next?.id || previous?.id);
	if (isVisible && (!wasVisible || contentChanged || payload.eventType === "INSERT")) {
		state.studentAnnouncementChanges.set(getAnnouncementSeenKey(next), next);
		openStudentAnnouncement(next);
	}
	if (!isVisible) {
		state.lastShownAnnouncementKey = null;
	}
	updateAnnouncementBadge();
	refreshStudentAnnouncements({ showPopup: false });
}
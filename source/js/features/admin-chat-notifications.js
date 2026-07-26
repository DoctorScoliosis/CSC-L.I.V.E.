/*
 * Notification bell + panel for the admin dashboard header.
 *
 * Aggregates unread messages and unread announcements into the bell badge
 * and renders the dropdown panel. Clicking a message notification opens the
 * matching conversation via a handler injected by the orchestrator
 * (setNotificationConversationOpener) to avoid a notifications -> thread
 * circular import.
 */

import { state, dom, supabase } from "../pages/admin-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import {
	getProfileDisplayName,
	getConversationUnreadCount,
	getCurrentContactUserId
} from "./admin-chat-helpers.js";

let openConversationHandler = null;

// Injected by the orchestrator: async (conversation) => void. Called when a
// message notification is clicked.
export function setNotificationConversationOpener(handler) {
	openConversationHandler = handler;
}

export function setNotificationPanelVisible(isVisible) {
	dom.notificationPanel?.classList.toggle("hidden", !isVisible);
	dom.messageNotificationBell?.setAttribute("aria-expanded", String(Boolean(isVisible)));
}

export function renderMessageNotifications() {
	if (!dom.notificationList) return;
	const unreadConversations = state.committeeAllConversationsData.filter(conversation =>
		getConversationUnreadCount(conversation) > 0
		|| state.latestUnreadMessages.has(String(conversation.id))
	);
	const messageItems = unreadConversations.map(conversation => {
		const isCreator = String(conversation.created_by) === String(getCurrentContactUserId());
		const otherUserId = isCreator ? conversation.receiver_id : conversation.created_by;
		const profile = state.contactPersonnelData.find(item => String(item.id) === String(otherUserId));
		const latestMessage = state.latestUnreadMessages.get(String(conversation.id));
		const previewText = latestMessage?.message_text || (latestMessage?.attachment_url ? "Photo" : conversation.last_message || "Photo");
		const previewTime = latestMessage?.created_at || conversation.last_message_at;
		return `
		<button type="button" data-notification-conversation-id="${escapeHTML(conversation.id || "")}" class="message-notification w-full rounded-xl px-3 py-3 text-left hover:bg-blue-50">
		<span class="block text-xs font-bold uppercase tracking-wide text-blue-700">New message</span>
		<span class="mt-1 block font-bold text-gray-900">${escapeHTML(getProfileDisplayName(profile))}</span>
		<span class="mt-1 block whitespace-pre-wrap break-words text-sm text-gray-600">${escapeHTML(previewText)}</span>
		<span class="mt-1 block text-xs text-gray-400">${previewTime ? escapeHTML(formatDateTime(previewTime)) : ""}</span>
		</button>
		`;
	});
	const announcementItems = [...state.unreadCommitteeAnnouncements.values()]
		.map(announcement => `
		<button type="button" data-announcement-notification-key="${escapeHTML(getCommitteeAnnouncementChangeKey(announcement))}" class="announcement-notification w-full rounded-xl px-3 py-3 text-left hover:bg-amber-50">
		<span class="block text-xs font-bold uppercase tracking-wide text-amber-700">${announcement.notification_label || "Announcement updated"}</span>
		<span class="mt-1 block font-bold text-gray-900">${escapeHTML(announcement.title || "Announcement")}</span>
		<span class="mt-1 block whitespace-pre-wrap break-words text-sm text-gray-600">${escapeHTML(announcement.message || "")}</span>
		<span class="mt-1 block text-xs text-gray-400">${announcement.created_at ? escapeHTML(formatDateTime(announcement.created_at)) : ""}</span>
		</button>
		`);
	dom.notificationList.innerHTML = [...messageItems, ...announcementItems].join("") || `
	<div class="px-3 py-6 text-center text-sm font-semibold text-gray-500">No new notifications.</div>
	`;
	document.querySelectorAll(".message-notification").forEach(button => {
		button.addEventListener("click", async function () {
			const conversation = state.committeeAllConversationsData.find(item => String(item.id) === String(this.dataset.notificationConversationId));
			if (!conversation) return;
			setNotificationPanelVisible(false);
			window.switchTab("contacts");
			if (typeof window.setContactsVisibleFromNotification === "function") {
				window.setContactsVisibleFromNotification(false);
			}
			if (openConversationHandler) {
				await openConversationHandler(conversation);
			}
		});
	});
	document.querySelectorAll(".announcement-notification").forEach(button => {
		button.addEventListener("click", function () {
			state.unreadCommitteeAnnouncements.delete(String(this.dataset.announcementNotificationKey || ""));
			setNotificationPanelVisible(false);
			updateMessageNotification();
			window.switchTab("overview");
			window.setTimeout(() => {
				const announcementsArea = document.getElementById("committeeAnnouncementsArea");
				if (!announcementsArea) return;
				announcementsArea.scrollIntoView({
					behavior: "smooth",
					block: "start"
				});
				announcementsArea.classList.add("ring-4", "ring-amber-300");
				window.setTimeout(() => {
					announcementsArea.classList.remove("ring-4", "ring-amber-300");
				}, 1800);
			}, 100);
		});
	});
}

export function updateMessageNotification() {
	const unreadMessageCount = state.committeeAllConversationsData.reduce(
		(total, conversation) => total + Math.max(
			getConversationUnreadCount(conversation),
			state.latestUnreadMessages.has(String(conversation.id)) ? 1 : 0
		),
		0
	);
	const unreadCount = unreadMessageCount + state.unreadCommitteeAnnouncements.size;
	if (dom.messageNotificationBadge) {
		dom.messageNotificationBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
		dom.messageNotificationBadge.classList.toggle("hidden", unreadCount === 0);
	}
	renderMessageNotifications();
}

export async function hydrateUnreadMessagePreviews(conversations) {
	const conversationIds = conversations.map(conversation => conversation.id).filter(Boolean);
	state.latestUnreadMessages.clear();
	if (!conversationIds.length || !getCurrentContactUserId()) return;
	const { data, error } = await supabase
		.from("messages")
		.select("conversation_id, message_text, attachment_url, created_at")
		.in("conversation_id", conversationIds)
		.eq("receiver_id", getCurrentContactUserId())
		.eq("is_read", false)
		.order("created_at", { ascending: false });
	if (error) {
		console.warn("Unable to load notification previews:", error.message || error);
		return;
	}
	(data || []).forEach(message => {
		const conversationId = String(message.conversation_id || "");
		if (conversationId && !state.latestUnreadMessages.has(conversationId)) {
			state.latestUnreadMessages.set(conversationId, message);
		}
	});
}

// Local copy so this module stays a leaf.
function getCommitteeAnnouncementChangeKey(announcement) {
	return [
		announcement?.id,
		announcement?.title || "",
		announcement?.message || ""
	].map(value => String(value ?? "")).join("|");
}
/*
 * Conversation thread for the admin Communications tab.
 *
 * Owns the "Recent" conversation list, the active chat thread, message
 * rendering and sending (with camera photo attachments), conversation
 * loading/hydration, and the chat-enabled / conversation-menu state.
 *
 * Imports updateMessageNotification + hydrateUnreadMessagePreviews from
 * admin-chat-notifications.js (one-directional; the notifications module
 * opens conversations via an orchestrator-injected handler instead).
 */

import { state, dom, supabase } from "../pages/admin-context.js";
import { normalizeComparableValue } from "../pages/admin-helpers.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";
import {
	getProfileDisplayName,
	getProfileSportName,
	getProfilePhone,
	getInitials,
	getRoleBadgeClass,
	getCurrentContactUserId,
	makeDirectConversationKey,
	getConversationUnreadCount
} from "./admin-chat-helpers.js";
import {
	updateMessageNotification,
	hydrateUnreadMessagePreviews
} from "./admin-chat-notifications.js";

export function clearCameraPhoto() {
	if (state.cameraPreviewUrl) {
		URL.revokeObjectURL(state.cameraPreviewUrl);
		state.cameraPreviewUrl = "";
	}
	if (dom.cameraInput) dom.cameraInput.value = "";
	state.cameraPhotoFile = null;
	if (dom.cameraPreviewImage) dom.cameraPreviewImage.removeAttribute("src");
	dom.cameraPreview?.classList.add("hidden");
	dom.cameraPreview?.classList.remove("flex");
}

export function resetActiveContactConversation() {
	state.activeContactProfile = null;
	state.activeContactConversation = null;
	state.activeContactConversationId = null;
	state.activeContactConversationIds = [];
	state.activeContactMessages = [];
	state.contactMessagesListMarkup = "";
	if (dom.activeChatTitle) {
		dom.activeChatTitle.textContent = "Select a conversation";
	}
	if (dom.activeChatSubtitle) {
		dom.activeChatSubtitle.textContent = "Select a conversation to start messaging.";
	}
	if (dom.activeChatAvatar) {
		dom.activeChatAvatar.textContent = "?";
	}
	if (dom.activeChatCall) {
		dom.activeChatCall.classList.add("hidden");
		dom.activeChatCall.href = "#";
	}
	if (dom.activeChatStatus) {
		dom.activeChatStatus.classList.add("hidden");
		dom.activeChatStatus.textContent = "Live";
		dom.activeChatStatus.className = "hidden rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700";
	}
	if (dom.contactMessageInput) {
		dom.contactMessageInput.value = "";
	}
	clearCameraPhoto();
	setConversationMenuVisible(false);
	setChatEnabled(false);
	renderContactMessages();
}

export function setChatEnabled(isEnabled) {
	const hasText = Boolean(dom.contactMessageInput?.value.trim());
	const hasPhoto = Boolean(state.cameraPhotoFile);
	if (dom.contactMessageInput) {
		dom.contactMessageInput.disabled = !isEnabled;
	}
	if (dom.sendContactMessage) {
		dom.sendContactMessage.disabled = !isEnabled || (!hasText && !hasPhoto);
	}
	if (dom.conversationMenuButton) {
		dom.conversationMenuButton.disabled = !isEnabled;
	}
}

export function setConversationMenuVisible(isVisible) {
	dom.conversationMenu?.classList.toggle("hidden", !isVisible);
	dom.conversationMenuButton?.setAttribute("aria-expanded", String(Boolean(isVisible)));
}

export async function deleteActiveConversation() {
	const conversationIds = state.activeContactConversationIds.length
		? state.activeContactConversationIds
		: [state.activeContactConversationId].filter(Boolean);
	if (!conversationIds.length) return;
	const confirmDelete = await showDashboardConfirm("Remove this conversation from your recent messages? The other participant will keep their copy.", {
		title: "Remove Conversation",
		confirmText: "Remove"
	});
	if (!confirmDelete) return;
	setConversationMenuVisible(false);
	const { error } = await supabase.rpc("set_conversation_visibility", {
		p_conversation_ids: conversationIds,
		p_hidden: true
	});
	if (error) {
		console.error("Error deleting admin conversation:", error.message || error);
		alert("Unable to delete the conversation. Run the messaging SQL patch and try again.");
		return;
	}
	resetActiveContactConversation();
	await loadCommitteeConversations();
	showDashboardToast("Conversation removed from recent messages.");
}

export async function loadCommitteeConversations() {
	if (!dom.committeeConversationList || !getCurrentContactUserId()) {
		return;
	}
	const [{ data, error }, { data: hiddenSettings, error: hiddenSettingsError }] = await Promise.all([
		supabase
			.from("conversations")
			.select("*")
			.or(`created_by.eq.${getCurrentContactUserId()},receiver_id.eq.${getCurrentContactUserId()}`)
			.order("last_message_at", { ascending: false, nullsFirst: false }),
		supabase
			.from("conversation_user_settings")
			.select("conversation_id")
			.eq("user_id", getCurrentContactUserId())
			.not("hidden_at", "is", null)
	]);
	if (error) {
		console.error("Error loading admin conversations:", error.message || error);
		dom.committeeConversationList.innerHTML = `
		<div class="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">
		Failed to load conversations.
		</div>
		`;
		return;
	}
	if (hiddenSettingsError) {
		console.warn("Unable to load hidden admin conversations:", hiddenSettingsError.message || hiddenSettingsError);
	}
	const hiddenConversationIds = new Set((hiddenSettings || []).map(setting => String(setting.conversation_id)));
	state.committeeAllConversationsData = (data || []).filter(conversation => !hiddenConversationIds.has(String(conversation.id)));
	await hydrateCommitteeConversationProfiles(state.committeeAllConversationsData);
	await hydrateUnreadMessagePreviews(state.committeeAllConversationsData);
	updateMessageNotification();
	if (
		state.activeContactConversationId
		&& !state.committeeAllConversationsData.some(conversation => state.activeContactConversationIds.includes(conversation.id))
	) {
		resetActiveContactConversation();
	}
	if (state.activeContactProfile?.id) {
		const activeKey = makeDirectConversationKey(getCurrentContactUserId(), state.activeContactProfile.id);
		state.activeContactConversationIds = state.committeeAllConversationsData
			.filter(conversation => makeDirectConversationKey(conversation.created_by, conversation.receiver_id) === activeKey)
			.map(conversation => conversation.id)
			.filter(Boolean);
	}
	const directConversationKeys = new Set();
	state.committeeConversationsData = state.committeeAllConversationsData.filter(conversation => {
		const key = makeDirectConversationKey(conversation.created_by, conversation.receiver_id);
		if (!key || directConversationKeys.has(key)) return false;
		directConversationKeys.add(key);
		return true;
	});
	renderCommitteeConversationList();
}

export async function hydrateCommitteeConversationProfiles(conversations) {
	const knownProfileIds = new Set(state.contactPersonnelData.map(profile => String(profile.id)));
	const missingProfileIds = [...new Set(
		conversations.flatMap(conversation => [conversation.created_by, conversation.receiver_id])
			.filter(userId => userId && String(userId) !== String(getCurrentContactUserId()))
			.map(String)
			.filter(userId => !knownProfileIds.has(userId))
	)];
	if (!missingProfileIds.length) return;
	const { data, error } = await supabase
		.from("user_profiles")
		.select("*")
		.in("id", missingProfileIds);
	if (error) {
		console.warn("Unable to hydrate messaging profile names:", error.message || error);
		return;
	}
	state.contactPersonnelData = [...state.contactPersonnelData, ...(data || [])];
}

export function renderCommitteeConversationList() {
	if (!dom.committeeConversationList) {
		return;
	}
	if (!state.committeeConversationsData.length) {
		const emptyMarkup = `
		<div class="rounded-xl bg-white p-3 text-sm font-semibold text-gray-500 shadow-sm">
		No conversations yet.
		</div>
		`;
		if (emptyMarkup !== state.committeeConversationListMarkup) {
			state.committeeConversationListMarkup = emptyMarkup;
			dom.committeeConversationList.innerHTML = emptyMarkup;
		}
		return;
	}
	const nextMarkup = state.committeeConversationsData.map(conversation => {
		const isCreator = String(conversation.created_by) === String(getCurrentContactUserId());
		const otherUserId = isCreator ? conversation.receiver_id : conversation.created_by;
		const otherProfile = state.contactPersonnelData.find(profile => String(profile.id) === String(otherUserId));
		const unreadCount = isCreator ? conversation.unread_count_sender : conversation.unread_count_receiver;
		const name = getProfileDisplayName(otherProfile);
		const role = otherProfile ? getRoleLabel(otherProfile.role) : "Account";
		const isActive = String(state.activeContactConversationId || "") === String(conversation.id);
		return `
		<button
		type="button"
		data-conversation-id="${escapeHTML(conversation.id || "")}"
		data-conversation-contact-id="${escapeHTML(otherUserId || "")}"
		class="committee-conversation-btn flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${isActive ? "bg-white shadow-sm ring-2 ring-blue-200" : "hover:bg-white hover:shadow-sm"}">
		<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">${escapeHTML(getInitials(name))}</span>
		<span class="min-w-0 flex-1">
		<span class="flex items-center justify-between gap-2">
		<span class="truncate font-bold text-gray-900">${escapeHTML(name)}</span>
		<span class="text-[11px] font-semibold text-gray-400">${conversation.last_message_at ? formatDateTime(conversation.last_message_at) : ""}</span>
		</span>
		<span class="mt-1 flex items-center gap-2">
		<span class="rounded-full px-2 py-0.5 text-[11px] font-bold ${getRoleBadgeClass(otherProfile?.role)}">${escapeHTML(role)}</span>
		${Number(unreadCount || 0) > 0 ? `<span class="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">${Number(unreadCount)}</span>` : ""}
		</span>
		<span class="mt-1 block truncate text-xs text-gray-500">${escapeHTML(conversation.last_message || "No messages yet")}</span>
		</span>
		</button>
		`;
	}).join("");
	if (nextMarkup === state.committeeConversationListMarkup) return;
	state.committeeConversationListMarkup = nextMarkup;
	dom.committeeConversationList.innerHTML = nextMarkup;
	document.querySelectorAll(".committee-conversation-btn").forEach(button => {
		button.addEventListener("click", async function () {
			const selectedConversation = state.committeeConversationsData.find(conversation => String(conversation.id) === String(this.dataset.conversationId));
			if (selectedConversation) {
				await openContactConversationRecord(selectedConversation);
			}
		});
	});
}

export function renderContactMessages() {
	if (!dom.contactMessagesList) return;
	if (!state.activeContactConversationId) {
		dom.contactMessagesList.innerHTML = `
		<div class="flex h-full items-center justify-center text-center text-sm font-semibold text-gray-500">
		Choose who you want to message from the contact list.
		</div>
		`;
		setChatEnabled(false);
		return;
	}
	if (state.activeContactMessages.length === 0) {
		dom.contactMessagesList.innerHTML = `
		<div class="flex h-full items-center justify-center text-center text-sm font-semibold text-gray-500">
		No messages yet. Send the first one.
		</div>
		`;
		setChatEnabled(true);
		return;
	}
	const currentUserId = getCurrentContactUserId();
	const nextMarkup = state.activeContactMessages.map(message => {
		const isMine = String(message.sender_id) === String(currentUserId);
		const deliveryStatus = message.is_read ? "Seen" : "Sent";
		return `
		<div class="mb-3 flex ${isMine ? "justify-end" : "justify-start"}">
		<div class="max-w-[78%] rounded-3xl px-4 py-3 shadow-sm ${isMine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md bg-white border border-gray-200 text-gray-900"}">
		${message.attachment_url ? `
		<a href="${escapeHTML(message.attachment_url)}" target="_blank" rel="noopener noreferrer">
		<img src="${escapeHTML(message.attachment_url)}" alt="Message attachment" loading="lazy" class="mb-2 max-h-72 w-full rounded-2xl object-cover">
		</a>
		` : ""}
		${message.message_text ? `<p class="whitespace-pre-wrap text-sm font-medium">${escapeHTML(message.message_text)}</p>` : ""}
		<div class="mt-2 flex items-center justify-end gap-2 text-[11px] ${isMine ? "text-blue-100" : "text-gray-400"}">
		<span>${formatDateTime(message.created_at)}</span>
		${isMine ? `<span class="font-bold">${escapeHTML(deliveryStatus)}</span>` : ""}
		</div>
		</div>
		</div>
		`;
	}).join("");
	if (nextMarkup === state.contactMessagesListMarkup) {
		setChatEnabled(true);
		return;
	}
	state.contactMessagesListMarkup = nextMarkup;
	dom.contactMessagesList.innerHTML = nextMarkup;
	dom.contactMessagesList.scrollTop = dom.contactMessagesList.scrollHeight;
	setChatEnabled(true);
}

export async function loadContactMessages() {
	if (!state.activeContactConversationId) {
		renderContactMessages();
		return;
	}
	const { data, error } = await supabase
		.from("messages")
		.select("*")
		.in("conversation_id", state.activeContactConversationIds.length ? state.activeContactConversationIds : [state.activeContactConversationId])
		.order("created_at", { ascending: true });
	if (error) {
		console.error("Error loading messages:", error.message || error);
		dom.contactMessagesList.innerHTML = `
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
		Failed to load messages. Run the messaging SQL and check RLS policies.
		</div>
		`;
		return;
	}
	state.activeContactMessages = data || [];
	renderContactMessages();
	await markActiveConversationRead();
}

export async function markActiveConversationRead() {
	if (!state.activeContactConversationId || !getCurrentContactUserId()) return;
	const { error: messagesError } = await supabase
		.from("messages")
		.update({ is_read: true })
		.in("conversation_id", state.activeContactConversationIds.length ? state.activeContactConversationIds : [state.activeContactConversationId])
		.eq("receiver_id", getCurrentContactUserId())
		.eq("is_read", false);
	if (messagesError) {
		console.warn("Error marking messages as read:", messagesError.message || messagesError);
	} else {
		(state.activeContactConversationIds.length ? state.activeContactConversationIds : [state.activeContactConversationId])
			.forEach(conversationId => state.latestUnreadMessages.delete(String(conversationId)));
		updateMessageNotification();
	}
	const { data: conversation } = await supabase
		.from("conversations")
		.select("created_by, receiver_id, unread_count_sender, unread_count_receiver")
		.eq("id", state.activeContactConversationId)
		.maybeSingle();
	if (conversation) {
		const isCreator = String(conversation.created_by) === String(getCurrentContactUserId());
		const unreadCount = isCreator
			? conversation.unread_count_sender
			: conversation.unread_count_receiver;
		if (Number(unreadCount || 0) > 0) {
			const unreadPayload = isCreator
				? { unread_count_sender: 0 }
				: { unread_count_receiver: 0 };
			const { error: conversationError } = await supabase
				.from("conversations")
				.update(unreadPayload)
				.eq("id", state.activeContactConversationId);
			if (!conversationError) {
				const cachedConversation = state.committeeAllConversationsData.find(
					item => String(item.id) === String(state.activeContactConversationId)
				);
				if (cachedConversation) Object.assign(cachedConversation, unreadPayload);
				updateMessageNotification();
			}
		}
	}
}

export async function openContactConversationRecord(conversation) {
	if (!conversation) return;
	const isCreator = String(conversation.created_by) === String(getCurrentContactUserId());
	const otherUserId = isCreator ? conversation.receiver_id : conversation.created_by;
	const otherRole = isCreator ? conversation.receiver_role : conversation.sender_role;
	const profile = state.contactPersonnelData.find(item => String(item.id) === String(otherUserId)) || {
		id: otherUserId,
		role: otherRole
	};
	await openContactConversation(profile, conversation);
}

export async function openContactConversation(profile, existingConversation = null) {
	if (!profile?.id || !getCurrentContactUserId()) {
		alert("Unable to identify the selected users for messaging.");
		return;
	}
	state.activeContactProfile = profile;
	const phone = getProfilePhone(profile);
	dom.activeChatTitle.textContent = getProfileDisplayName(profile);
	dom.activeChatSubtitle.textContent = `${getRoleLabel(profile.role)} • ${getProfileSportName(profile)}`;
	dom.activeChatAvatar.textContent = getInitials(getProfileDisplayName(profile));
	if (phone) {
		dom.activeChatCall.href = `tel:${phone}`;
		dom.activeChatCall.classList.remove("hidden");
	} else {
		dom.activeChatCall.classList.add("hidden");
		dom.activeChatCall.href = "#";
	}
	dom.activeChatStatus.textContent = "Live";
	dom.activeChatStatus.className = "rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700";
	setChatEnabled(false);
	dom.committeeChatShell.classList.add("chat-open");
	// renderContactsList is wired by the orchestrator to avoid a thread ->
	// contacts import.
	if (typeof window.renderAdminContactsListFromThread === "function") {
		window.renderAdminContactsListFromThread();
	}
	const currentUserId = getCurrentContactUserId();
	const otherUserId = profile.id;
	const conversationResult = await supabase
		.from("conversations")
		.select("*")
		.or(`and(created_by.eq.${currentUserId},receiver_id.eq.${otherUserId}),and(created_by.eq.${otherUserId},receiver_id.eq.${currentUserId})`)
		.order("last_message_at", { ascending: false, nullsFirst: false });
	let matchingConversations = conversationResult.data || [];
	let conversation = matchingConversations[0] || existingConversation;
	let conversationError = conversationResult.error;
	if (!conversation && !conversationError) {
		const insertResult = await supabase
			.from("conversations")
			.insert([{
				created_by: currentUserId,
				receiver_id: otherUserId,
				sender_role: state.currentUser?.role || "committee",
				receiver_role: normalizeComparableValue(profile.role || "admin"),
				status: "open"
			}])
			.select("*")
			.single();
		conversation = insertResult.data;
		conversationError = insertResult.error;
		matchingConversations = conversation ? [conversation] : [];
	}
	if (conversationError || !conversation) {
		console.error("Error opening conversation:", conversationError?.message || conversationError);
		alert(`Unable to open messaging: ${conversationError?.message || "Run the messaging SQL and check RLS policies."}`);
		return;
	}
	const conversationIdsToRestore = [...new Set(
		(matchingConversations.length ? matchingConversations : [conversation]).map(item => item.id).filter(Boolean)
	)];
	const { error: visibilityError } = await supabase.rpc("set_conversation_visibility", {
		p_conversation_ids: conversationIdsToRestore,
		p_hidden: false
	});
	if (visibilityError) {
		console.warn("Unable to restore admin conversation visibility:", visibilityError.message || visibilityError);
	}
	if (String(state.activeContactConversationId || "") !== String(conversation.id)) {
		state.contactMessagesListMarkup = "";
	}
	state.activeContactConversation = conversation;
	state.activeContactConversationId = conversation.id;
	state.activeContactConversationIds = [...new Set(
		(matchingConversations.length ? matchingConversations : [conversation]).map(item => item.id).filter(Boolean)
	)];
	await loadContactMessages();
	await loadCommitteeConversations();
}

export async function sendContactMessageSubmit(event) {
	event.preventDefault();
	if (!state.activeContactConversationId || !state.activeContactProfile) {
		alert("Select a contact before sending a message.");
		return;
	}
	const messageText = dom.contactMessageInput.value.trim();
	const selectedPhoto = state.cameraPhotoFile;
	if (!messageText && !selectedPhoto) {
		dom.contactMessageInput.focus();
		return;
	}
	dom.sendContactMessage.disabled = true;
	dom.sendContactMessage.textContent = "Sending...";
	try {
		let attachmentUrl = null;
		let attachmentPath = null;
		if (selectedPhoto) {
			const extension = selectedPhoto.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
			const attachmentId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			attachmentPath = `${getCurrentContactUserId()}/${attachmentId}.${extension}`;
			const uploadResult = await supabase.storage
				.from("message-attachments")
				.upload(attachmentPath, selectedPhoto, {
					contentType: selectedPhoto.type || "image/jpeg",
					upsert: false
				});
			if (uploadResult.error) throw uploadResult.error;
			attachmentUrl = supabase.storage
				.from("message-attachments")
				.getPublicUrl(attachmentPath).data.publicUrl;
		}
		const { error } = await supabase.rpc("send_conversation_message", {
			p_conversation_id: state.activeContactConversationId,
			p_receiver_id: state.activeContactProfile.id,
			p_message_text: messageText || null,
			p_attachment_url: attachmentUrl,
			p_attachment_path: attachmentPath
		});
		if (error) throw error;
		dom.contactMessageInput.value = "";
		clearCameraPhoto();
		await Promise.all([
			loadContactMessages(),
			loadCommitteeConversations()
		]);
	} catch (error) {
		console.error("Error sending message:", error.message || error);
		alert(`Message failed: ${error.message || "Check the messaging SQL and RLS policies."}`);
	} finally {
		dom.sendContactMessage.textContent = "Send";
		setChatEnabled(Boolean(state.activeContactConversationId));
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
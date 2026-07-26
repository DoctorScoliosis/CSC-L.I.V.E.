/*
 * Pure display / grouping / key helpers for the admin Communications tab.
 *
 * Leaf module: reads state only, imports no other chat module. Used by the
 * contacts list, the conversation thread, and the notification panel.
 */

import { state } from "../pages/admin-context.js";
import { normalizeComparableValue } from "../pages/admin-helpers.js";

export function getProfileDisplayName(profile) {
	return profile?.full_name || profile?.fullName || profile?.name || profile?.email || "Committee";
}

export function getProfileSportName(profile) {
	if (normalizeComparableValue(profile?.role) === "admin") {
		return profile?.assigned_sport_name || profile?.sport_name || profile?.sport || "Administration";
	}
	return profile?.assigned_sport_name || profile?.sport_name || profile?.sport || "Unassigned";
}

export function getProfilePhone(profile) {
	return String(profile?.contact_phone || profile?.mobile_number || profile?.mobileNumber || profile?.phone_number || profile?.phone || profile?.contact_number || "").trim();
}

export function getInitials(name) {
	return String(name || "?")
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map(part => part.charAt(0).toUpperCase())
		.join("") || "?";
}

export function getRoleBadgeClass(role) {
	return normalizeComparableValue(role) === "admin"
		? "bg-blue-100 text-blue-700"
		: "bg-yellow-100 text-yellow-800";
}

export function getContactSportGroups(sports = state.registeredSportsData) {
	const groups = new Map();
	(sports || []).forEach(sport => {
		const sportName = sport.sport_name || sport.name || "Unnamed sport";
		const generalName = getGeneralSportName(sportName);
		const key = normalizeSportGroupKey(generalName);
		if (!groups.has(key)) {
			groups.set(key, {
				id: `__sport_group__:${key}`,
				sport_name: generalName,
				sourceSports: []
			});
		}
		groups.get(key).sourceSports.push(sport);
	});
	return [...groups.values()].sort((a, b) => a.sport_name.localeCompare(b.sport_name));
}

export function getContactSportGroupKey(profile) {
	if (!profile || normalizeComparableValue(profile.role) === "admin") {
		return "";
	}
	const assignedSportId = String(profile.assigned_sport_id || profile.assigned_game_id || profile.sport_id || "").trim();
	const assignedSport = state.registeredSportsData.find(sport => String(sport.id) === assignedSportId);
	const assignedSportName = assignedSport?.sport_name || getProfileSportName(profile);
	return normalizeSportGroupKey(getGeneralSportName(assignedSportName));
}

export function getCurrentContactUserId() {
	return state.currentUser?.id || "";
}

export function makeDirectConversationKey(firstUserId, secondUserId) {
	return [String(firstUserId || "").trim(), String(secondUserId || "").trim()]
		.filter(Boolean)
		.sort()
		.join(":");
}

export function getConversationUnreadCount(conversation) {
	const isCreator = String(conversation.created_by) === String(getCurrentContactUserId());
	return Number(isCreator ? conversation.unread_count_sender : conversation.unread_count_receiver) || 0;
}

// Local copies of the sport-name helpers so this module stays a leaf.
function normalizeSportGroupKey(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

function getGeneralSportName(name) {
	const cleanedName = String(name || "Unnamed sport")
		.replace(/\s+/g, " ")
		.trim();
	const categoryStartWords = new Set([
		"a", "b", "c", "d", "e",
		"boys", "boy", "girls", "girl",
		"men", "man", "mens", "male",
		"women", "woman", "womens", "female",
		"mixed", "singles", "single", "doubles", "double",
		"relay", "backstroke", "butterfly", "freestyle",
		"division", "div", "category", "cat",
		"bracket", "pool", "group", "class"
	]);
	const normalizedName = cleanedName
		.replace(/[()']/g, " ")
		.replace(/[-:/]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const tokens = normalizedName.split(" ").filter(Boolean);
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index].toLowerCase();
		if (
			categoryStartWords.has(token)
			|| /^[a-e]$/i.test(token)
			|| /^\d/.test(token)
			|| /^\d+m$/i.test(token)
		) {
			return tokens.slice(0, index).join(" ") || cleanedName;
		}
	}
	return tokens.join(" ") || cleanedName;
}
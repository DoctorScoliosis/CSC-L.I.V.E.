/*
 * Overview counts + announcements for the Committee dashboard.
 *
 * Owns the eight overview stat cards and the admin-announcements panel.
 * Announcement changes also feed the notification bell, so this module
 * calls updateMessageNotification (from committee-chat.js) whenever the
 * unread-announcement set changes. The announcement state itself lives in
 * committee-context.js so the chat module can read it without a cycle.
 */

import {
	state,
	dom,
	supabase,
	TEAMS_TABLE,
	PARTICIPANTS_TABLE,
	MATCHES_TABLE,
	SPORTS_TABLE,
	ANNOUNCEMENTS_TABLE
} from "../pages/committee-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTimeShort as formatDateTime } from "../utils/datetime.js";
import { updateMessageNotification } from "./committee-chat.js";

async function countRows(tableName) {
	const { count, error } = await supabase
		.from(tableName)
		.select("*", {
			count: "exact",
			head: true
		});
	if (error) {
		console.error(`Error counting ${tableName}:`, error.message || error);
		return 0;
	}
	return count || 0;
}

async function countMatchesByStatus(statusValue) {
	const { count, error } = await supabase
		.from(MATCHES_TABLE)
		.select("*", {
			count: "exact",
			head: true
		})
		.eq("status", statusValue);
	if (error) {
		console.error(`Error counting ${statusValue} matches:`, error.message || error);
		return 0;
	}
	return count || 0;
}

function setTextIfChanged(element, value) {
	if (!element) {
		return;
	}
	const nextValue = String(value);
	if (element.textContent !== nextValue) {
		element.textContent = nextValue;
	}
}

async function loadOverviewMatches() {
	const { data, error } = await supabase
		.from(MATCHES_TABLE)
		.select("match_time");
	if (error) {
		console.error("Error loading overview match days:", error.message || error);
		return [];
	}
	return data || [];
}

function countUniqueMatchDays(matches) {
	const uniqueDays = new Set();
	(matches || []).forEach(match => {
		if (match.match_time) {
			uniqueDays.add(new Date(match.match_time).toLocaleDateString("en-CA"));
		}
	});
	return uniqueDays.size;
}

export async function loadOverviewCounts() {
	const [
		totalTeams,
		totalSports,
		totalParticipants,
		totalMatches,
		upcomingMatches,
		activeMatches,
		completedMatches
	] = await Promise.all([
		countRows(TEAMS_TABLE),
		countRows(SPORTS_TABLE),
		countRows(PARTICIPANTS_TABLE),
		countRows(MATCHES_TABLE),
		countMatchesByStatus("Next"),
		countMatchesByStatus("Ongoing"),
		countMatchesByStatus("Done")
	]);
	const matches = await loadOverviewMatches();
	setTextIfChanged(dom.teamsCount, totalTeams);
	setTextIfChanged(dom.committeeTotalSports, totalSports);
	setTextIfChanged(dom.participantsCount, totalParticipants);
	setTextIfChanged(dom.committeeTotalMatches, totalMatches);
	setTextIfChanged(dom.upcomingMatchesCount, upcomingMatches);
	setTextIfChanged(dom.committeeActiveGames, activeMatches);
	setTextIfChanged(dom.completedMatchesCount, completedMatches);
	setTextIfChanged(dom.committeeTotalDays, countUniqueMatchDays(matches));
}

export function getCommitteeAnnouncementChangeKey(announcement) {
	return [
		announcement?.id,
		announcement?.title || "",
		announcement?.message || ""
	].map(value => String(value ?? "")).join("|");
}

export function clearCommitteeAnnouncementNotifications(announcementId) {
	if (!announcementId) return;
	[...state.unreadCommitteeAnnouncements.entries()].forEach(([key, announcement]) => {
		if (String(announcement.id) === String(announcementId)) {
			state.unreadCommitteeAnnouncements.delete(key);
		}
	});
}

export async function loadCommitteeAnnouncements() {
	if (!dom.committeeAnnouncementsList) return;
	if (state.isLoadingCommitteeAnnouncements) {
		state.shouldReloadCommitteeAnnouncementsAgain = true;
		return;
	}
	state.isLoadingCommitteeAnnouncements = true;
	state.shouldReloadCommitteeAnnouncementsAgain = false;
	try {
		const { data, error } = await supabase
			.from(ANNOUNCEMENTS_TABLE)
			.select("*")
			.eq("is_active", true)
			.in("audience", ["all", "committee"])
			.order("created_at", { ascending: false });
		if (error) {
			console.error("Error loading committee announcements:", error.message || error);
			dom.committeeAnnouncementsList.innerHTML = `
			<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
			Failed to load announcements.
			</div>
			`;
			return;
		}
		const announcements = data || [];
		if (state.hasLoadedCommitteeAnnouncements) {
			announcements.forEach(item => {
				const previous = state.committeeAnnouncementsData.find(existing => String(existing.id) === String(item.id));
				if (!previous || getCommitteeAnnouncementChangeKey(previous) !== getCommitteeAnnouncementChangeKey(item)) {
					state.unreadCommitteeAnnouncements.set(getCommitteeAnnouncementChangeKey(item), {
						...item,
						notification_label: previous ? "Announcement updated" : "New announcement"
					});
				}
			});
		}
		state.committeeAnnouncementsData = announcements;
		const visibleAnnouncementIds = new Set(announcements.map(item => String(item.id)));
		[...state.unreadCommitteeAnnouncements.entries()].forEach(([key, announcement]) => {
			if (!visibleAnnouncementIds.has(String(announcement.id))) {
				state.unreadCommitteeAnnouncements.delete(key);
			}
		});
		state.hasLoadedCommitteeAnnouncements = true;
		updateMessageNotification();
		if (announcements.length === 0) {
			dom.committeeAnnouncementsList.innerHTML = `
			<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600">
			No active announcements.
			</div>
			`;
			return;
		}
		dom.committeeAnnouncementsList.innerHTML = announcements.map(item => `
		<div class="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
		<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
		<h3 class="font-bold text-blue-950">${escapeHTML(item.title)}</h3>
		<span class="text-xs font-semibold text-blue-700">${formatDateTime(item.created_at)}</span>
		</div>
		<p class="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-800">${escapeHTML(item.message)}</p>
		</div>
		`).join("");
	} finally {
		state.isLoadingCommitteeAnnouncements = false;
		if (state.shouldReloadCommitteeAnnouncementsAgain) {
			state.shouldReloadCommitteeAnnouncementsAgain = false;
			await loadCommitteeAnnouncements();
		}
	}
}

export function notifyCommitteeAnnouncementChange(payload) {
	const previous = payload.old;
	const next = payload.new;
	const wasVisible = Boolean(previous?.is_active) && ["all", "committee"].includes(String(previous?.audience || ""));
	const isVisible = Boolean(next?.is_active) && ["all", "committee"].includes(String(next?.audience || ""));
	const contentChanged = Boolean(previous && next)
		&& (String(previous.title || "") !== String(next.title || "")
		|| String(previous.message || "") !== String(next.message || ""));
	clearCommitteeAnnouncementNotifications(next?.id || previous?.id);
	if (isVisible && (!wasVisible || contentChanged || payload.eventType === "INSERT")) {
		const notificationItem = {
			...next,
			notification_label: wasVisible ? "Announcement updated" : "New announcement"
		};
		state.unreadCommitteeAnnouncements.set(getCommitteeAnnouncementChangeKey(notificationItem), notificationItem);
	}
	updateMessageNotification();
	loadCommitteeAnnouncements();
}
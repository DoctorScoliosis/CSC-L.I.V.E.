/*
 * Match schedule for the Student dashboard.
 *
 * Owns the schedule cards (Upcoming / Ongoing / Completed), the status and
 * sport-category filters, the pre-game countdown timers, and the match
 * details modal. Reads matches + game history + basketball stats; never
 * writes to the database.
 *
 * NOTE: getGeneralSportName here intentionally keeps the student flavour
 * (no bare "s" category token) to preserve the original schedule-filter
 * grouping. It differs from utils/sports.js on purpose — do not "unify"
 * them without checking the filter behaviour.
 */

import {
	supabase,
	state,
	dom,
	MATCHES_TABLE,
	GAME_HISTORY_TABLE,
	BASKETBALL_STATS_TABLE,
	SPORTS_TABLE,
	STUDENT_SCHEDULE_FILTER_KEY,
	STUDENT_SPORT_CATEGORY_FILTER_KEY,
	VALID_STUDENT_SCHEDULE_FILTERS
} from "../pages/student-context.js";
import { escapeHTML } from "../utils/dom.js";
import {
	formatDateTimeShort as formatDateTime,
	clampTimerSeconds,
	formatTimerDisplay,
	calculateRemainingSeconds
} from "../utils/datetime.js";
import { normalizeSportGroupKey } from "../utils/normalize.js";
import {
	getTeamName,
	getSportName,
	isBasketballSport,
	isVolleyballSport,
	renderStudentBasketballScoreSheet
} from "./student-basketball.js";

// --- Sport category grouping (student flavour) -------------------------------

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

function getStudentSportCategoryGroups(sports = state.registeredSports) {
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

function getMatchSportGroupId(match) {
	return `__sport_group__:${normalizeSportGroupKey(getGeneralSportName(getSportName(match)))}`;
}

export async function loadSportCategoryFilterOptions() {
	const { data, error } = await supabase
		.from(SPORTS_TABLE)
		.select("id, sport_name")
		.order("sport_name", { ascending: true });
	if (error) {
		console.error("Error loading sport category filters:", error.message || error);
		return;
	}
	state.registeredSports = data || [];
	if (!dom.gameCategoryFilter) return;
	const previousValue = state.activeSportCategoryFilter || "All";
	dom.gameCategoryFilter.innerHTML = `<option value="All">All Sports</option>`;
	const sportGroups = getStudentSportCategoryGroups(state.registeredSports);
	sportGroups.forEach(sport => {
		const option = document.createElement("option");
		option.value = sport.id;
		option.textContent = sport.sport_name || "Unnamed Sport";
		dom.gameCategoryFilter.appendChild(option);
	});
	const savedExactSport = state.registeredSports.find(sport => String(sport.id) === String(previousValue));
	const migratedGroupValue = savedExactSport
		? `__sport_group__:${normalizeSportGroupKey(getGeneralSportName(savedExactSport.sport_name || savedExactSport.name))}`
		: previousValue;
	const stillExists = migratedGroupValue === "All" || sportGroups.some(sport => String(sport.id) === String(migratedGroupValue));
	state.activeSportCategoryFilter = stillExists ? migratedGroupValue : "All";
	localStorage.setItem(STUDENT_SPORT_CATEGORY_FILTER_KEY, state.activeSportCategoryFilter);
	dom.gameCategoryFilter.value = state.activeSportCategoryFilter;
	if (state.studentMatchesData.length > 0) {
		renderMatches();
	}
}

// --- Status + period labels --------------------------------------------------

export function getStatusMeta(status) {
	if (status === "Done") {
		return {
			label: "Completed",
			badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
			border: "border-emerald-100",
			heading: "Completed Match",
			icon: "✅"
		};
	}
	if (status === "Ongoing") {
		return {
			label: "Ongoing",
			badge: "bg-red-100 text-red-700 border-red-200 animate-pulse",
			border: "border-red-100",
			heading: "Ongoing Match",
			icon: "🔴"
		};
	}
	return {
		label: "Upcoming",
		badge: "bg-blue-100 text-blue-700 border-blue-200",
		border: "border-blue-100",
		heading: "Upcoming Match",
		icon: "🕒"
	};
}

function getMatchStageLabel(stage) {
	if (!String(stage || "").trim()) {
		return "Elimination Round";
	}
	return {
		regular: "Elimination Round",
		semifinals: "Semifinals",
		finals: "Finals",
		battle_for_third: "Battle for Third"
	}[stage] || "";
}

function getLivePeriodLabel(match) {
	if (match.status !== "Ongoing") return "";
	if (isBasketballSport(match)) return `Quarter ${match.game_period || 1}`;
	if (isVolleyballSport(match)) return `Set ${match.game_period || 1}`;
	return "";
}

// --- Countdown timers --------------------------------------------------------

export function updateCountdownDisplays() {
	document.querySelectorAll(".student-match-countdown").forEach(display => {
		const duration = clampTimerSeconds(display.dataset.durationSeconds) || 600;
		const isEnabled = display.dataset.timerEnabled === "true";
		const startedAt = display.dataset.startedAt;
		let remaining = duration;
		if (isEnabled && startedAt) {
			const startedAtMs = new Date(startedAt).getTime();
			if (!Number.isNaN(startedAtMs)) {
				const elapsed = Math.floor((Date.now() - startedAtMs) / 1000);
				remaining = Math.max(duration - elapsed, 0);
			}
		}
		display.textContent = formatTimerDisplay(remaining);
		if (isEnabled && remaining <= 0) {
			display.classList.add("text-red-600");
		} else {
			display.classList.remove("text-red-600");
		}
	});
}

// --- Match loading + rendering -----------------------------------------------

export async function loadMatches(options = {}) {
	if (state.isLoadingMatches) {
		state.shouldReloadMatchesAgain = true;
		return;
	}
	state.isLoadingMatches = true;
	state.shouldReloadMatchesAgain = false;
	if (state.studentMatchesData.length === 0) {
		dom.studentMatchesGrid.innerHTML = `
		<div class="col-span-full py-20 text-center bg-white rounded-2xl border border-slate-200">
		<div class="flex flex-col items-center space-y-3">
		<div class="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
		<p class="text-slate-500 font-medium">Fetching latest matches...</p>
		</div>
		</div>
		`;
	}
	const { data, error } = await supabase
		.from(MATCHES_TABLE)
		.select(`
		id, sport_id, team_one_id, team_two_id, match_time, location, status, timer_enabled, timer_duration_seconds, timer_started_at, match_stage, game_period,
		sport:sports!scheduled_matches_sport_id_fkey(id, sport_name),
		team_one:sports_leaderboard!scheduled_matches_team_one_fkey(team),
		team_two:sports_leaderboard!scheduled_matches_team_two_fkey(team)
		`)
		.order("match_time", { ascending: false });
	if (error) {
		console.error("Student match load error:", error.message || error);
		if (state.studentMatchesData.length === 0) {
			dom.studentMatchesGrid.innerHTML = `<div class="col-span-full p-10 text-center text-red-500 font-bold">Failed to load matches.</div>`;
		}
		state.isLoadingMatches = false;
		if (state.shouldReloadMatchesAgain) {
			state.shouldReloadMatchesAgain = false;
			await loadMatches({ showLoading: false });
		}
		return;
	}
	state.studentMatchesData = data || [];
	const matchIds = state.studentMatchesData.map(m => m.id);
	state.basketballStatsByMatch = new Map();
	if (matchIds.length > 0) {
		const { data: historyRows, error: historyError } = await supabase.from(GAME_HISTORY_TABLE).select("*").in("match_id", matchIds);
		if (!historyError && Array.isArray(historyRows)) {
			const historyMap = new Map();
			historyRows.forEach(h => historyMap.set(Number(h.match_id), h));
			state.studentMatchesData = state.studentMatchesData.map(m => ({ ...m, game_history: historyMap.get(Number(m.id)) || null }));
		}
		const { data: basketballRows, error: basketballError } = await supabase
			.from(BASKETBALL_STATS_TABLE)
			.select("*")
			.in("match_id", matchIds);
		if (basketballError) {
			console.warn("Student basketball score sheet load warning:", basketballError.message || basketballError);
		} else if (Array.isArray(basketballRows)) {
			basketballRows.forEach(row => {
				const key = Number(row.match_id);
				if (!state.basketballStatsByMatch.has(key)) {
					state.basketballStatsByMatch.set(key, []);
				}
				state.basketballStatsByMatch.get(key).push(row);
			});
		}
	}
	const basketballSignature = JSON.stringify([...state.basketballStatsByMatch.entries()]);
	const matchesSignature = JSON.stringify(state.studentMatchesData) + basketballSignature;
	if (matchesSignature !== state.lastMatchesSignature) {
		renderMatches();
		state.lastMatchesSignature = matchesSignature;
	}
	state.isLoadingMatches = false;
	if (state.shouldReloadMatchesAgain) {
		state.shouldReloadMatchesAgain = false;
		await loadMatches({ showLoading: false });
	}
}

export function renderMatches() {
	let filtered = [...state.studentMatchesData];
	const showOngoingSingleColumn = state.activeScheduleFilter === "Ongoing";
	dom.studentMatchesGrid.className = showOngoingSingleColumn
		? "grid grid-cols-1 gap-6"
		: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6";
	if (state.activeScheduleFilter !== "All") {
		filtered = filtered.filter(m => m.status === state.activeScheduleFilter);
	}
	if (state.activeSportCategoryFilter !== "All") {
		filtered = filtered.filter(m =>
			String(m.sport_id) === String(state.activeSportCategoryFilter) ||
			String(m.sport?.id) === String(state.activeSportCategoryFilter) ||
			getMatchSportGroupId(m) === state.activeSportCategoryFilter
		);
	}
	if (filtered.length === 0) {
		dom.studentMatchesGrid.innerHTML = `<div class="col-span-full py-20 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 italic">No matches found for the selected status and game category.</div>`;
		return;
	}
	const sorted = [...filtered].sort((a, b) => {
		const hasActiveCountdown = match =>
			match.status === "Next"
			&& Boolean(match.timer_enabled)
			&& Boolean(match.timer_started_at);
		const countdownDiff = Number(hasActiveCountdown(b)) - Number(hasActiveCountdown(a));
		if (countdownDiff !== 0) return countdownDiff;
		if (hasActiveCountdown(a) && hasActiveCountdown(b)) {
			const remainingDiff = calculateRemainingSeconds(a) - calculateRemainingSeconds(b);
			if (remainingDiff !== 0) return remainingDiff;
		}
		const order = { Ongoing: 0, Next: 1, Done: 2 };
		const diff = (order[a.status] ?? 99) - (order[b.status] ?? 99);
		return diff !== 0 ? diff : new Date(b.match_time || 0) - new Date(a.match_time || 0);
	});
	dom.studentMatchesGrid.innerHTML = "";
	sorted.forEach(match => {
		const meta = getStatusMeta(match.status);
		const t1 = getTeamName(match, "one");
		const t2 = getTeamName(match, "two");
		const history = match.game_history;
		const remaining = calculateRemainingSeconds(match);
		const duration = clampTimerSeconds(match.timer_duration_seconds) || 600;
		const isUpcoming = match.status === "Next";
		const isDone = match.status === "Done";
		const showTimer = isUpcoming && (match.timer_enabled || duration > 0);
		const matchStageLabel = getMatchStageLabel(match.match_stage);
		const livePeriodLabel = getLivePeriodLabel(match);
		const card = document.createElement("div");
		card.className = "card-hover bg-white rounded-2xl border border-slate-300 overflow-hidden flex flex-col";
		card.innerHTML = `
		<div class="p-6 flex-1">
		<div class="flex justify-between items-start gap-4 mb-6">
		<div class="min-w-0">
		<h3 class="text-2xl font-black text-slate-900 leading-tight break-words"> ${escapeHTML(getSportName(match))}</h3>
		</div>
		<span class="shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${meta.badge}">
		${meta.label}
		</span>
		</div>
		${matchStageLabel || livePeriodLabel ? `
		<div class="mb-3 grid w-full ${matchStageLabel && livePeriodLabel ? "grid-cols-2" : "grid-cols-1"} gap-2">
		${matchStageLabel ? `<div class="rounded-2xl border border-red-300 bg-red-100 px-4 py-3 text-center text-xs font-black uppercase tracking-widest text-red-800">${escapeHTML(matchStageLabel)}</div>` : ""}
		${livePeriodLabel ? `<div class="rounded-2xl border border-red-300 bg-red-100 px-4 py-3 text-center text-xs font-black uppercase tracking-widest text-red-800">${escapeHTML(livePeriodLabel)}</div>` : ""}
		</div>
		` : ""}
		${showTimer ? `
		<div class="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center">
		<p class="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Pre-game Timer</p>
		<p class="student-match-countdown text-3xl font-black leading-none tracking-tighter text-slate-900"
		data-match-id="${match.id}" data-duration-seconds="${duration}"
		data-timer-enabled="${match.timer_enabled}" data-started-at="${match.timer_started_at || ''}">
		${formatTimerDisplay(remaining)}
		</p>
		</div>
		` : ''}
		<div class="flex items-center justify-between gap-3 mb-6 rounded-2xl border border-slate-300 bg-white/60 p-3">
		<div class="flex-1 min-w-0 text-center">
		<p class="text-[10px] font-black text-slate-700 uppercase mb-1">Team 1</p>
		<p class="text-lg sm:text-xl font-black text-blue-700 truncate">${escapeHTML(t1)}</p>
		</div>
		<div class="shrink-0 text-red-600 text-lg font-black italic">VS</div>
		<div class="flex-1 min-w-0 text-center">
		<p class="text-[10px] font-black text-slate-700 uppercase mb-1">Team 2</p>
		<p class="text-lg sm:text-xl font-black text-emerald-700 truncate">${escapeHTML(t2)}</p>
		</div>
		</div>
		${renderStudentBasketballScoreSheet(match, { compact: true })}
		<div class="space-y-2 pt-4 border-t border-slate-300">
		<div class="flex items-center text-sm text-slate-800 font-bold">
		<span class="mr-2 text-slate-950">TIME:</span> ${formatDateTime(match.match_time)}
		</div>
		<div class="flex items-center text-sm text-slate-800 font-bold">
		<span class="mr-2 text-slate-950">LOCATION:</span> ${escapeHTML(match.location || "No location set")}
		</div>
		</div>
		${isDone && history ? `
		<div class="mt-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
		<p class="text-[10px] font-bold text-emerald-600 uppercase mb-2">Final Result</p>
		<p class="text-sm font-bold text-emerald-900">Winner: ${escapeHTML(history.winner_team_name)}</p>
		<p class="text-sm font-bold text-emerald-900 mt-1">Player of the Game: ${escapeHTML(history.best_player || "Not recorded")}</p>
		</div>
		` : ''}
		</div>
		`;
		dom.studentMatchesGrid.appendChild(card);
	});
	updateCountdownDisplays();
}

// --- Match details modal -----------------------------------------------------

export function openMatchDetails(match) {
	const history = match.game_history;
	const meta = getStatusMeta(match.status);
	const duration = clampTimerSeconds(match.timer_duration_seconds) || 600;
	const remaining = calculateRemainingSeconds(match);
	const showTimer = match.status === "Next";
	const matchStageLabel = getMatchStageLabel(match.match_stage);
	const livePeriodLabel = getLivePeriodLabel(match);
	dom.matchDetailsModal.classList.remove("hidden");
	dom.matchDetailsModal.classList.add("flex");
	dom.matchDetailsTitle.textContent = `${getSportName(match)} - Match Details`;
	dom.matchDetailsContent.innerHTML = `
	<div class="space-y-8">
	<div class="flex justify-between items-start">
	<div>
	<p class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Sporting Event</p>
	<h3 class="text-3xl font-black text-slate-900">${escapeHTML(getSportName(match))}</h3>
	</div>
	<span class="px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${meta.badge}">
	${meta.label}
	</span>
	</div>
	${matchStageLabel || livePeriodLabel ? `
	<div class="grid w-full ${matchStageLabel && livePeriodLabel ? "grid-cols-2" : "grid-cols-1"} gap-2">
	${matchStageLabel ? `<div class="w-full rounded-2xl border border-red-300 bg-red-100 px-4 py-3 text-center text-xs font-black uppercase tracking-widest text-red-800">${escapeHTML(matchStageLabel)}</div>` : ""}
	${livePeriodLabel ? `<div class="w-full rounded-2xl border border-red-300 bg-red-100 px-4 py-3 text-center text-xs font-black uppercase tracking-widest text-red-800">${escapeHTML(livePeriodLabel)}</div>` : ""}
	</div>
	` : ""}
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
	<div class="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-center">
	<p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Team 1</p>
	<p class="text-xl font-black text-slate-900">${escapeHTML(getTeamName(match, "one"))}</p>
	</div>
	<div class="text-center font-black text-slate-200 text-2xl italic">VS</div>
	<div class="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-center">
	<p class="text-[10px] font-bold text-slate-400 uppercase mb-2">Team 2</p>
	<p class="text-xl font-black text-slate-900">${escapeHTML(getTeamName(match, "two"))}</p>
	</div>
	</div>
	${renderStudentBasketballScoreSheet(match)}
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
	<div class="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm flex items-center">
	<div class="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mr-4 text-xl">📅</div>
	<div>
	<p class="text-[10px] font-bold text-slate-400 uppercase">Scheduled Time</p>
	<p class="font-bold text-slate-900">${formatDateTime(match.match_time)}</p>
	</div>
	</div>
	<div class="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm flex items-center">
	<div class="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center mr-4 text-xl">📍</div>
	<div>
	<p class="text-[10px] font-bold text-slate-400 uppercase">Location</p>
	<p class="font-bold text-slate-900">${escapeHTML(match.location || "No location set")}</p>
	</div>
	</div>
	</div>
	${showTimer ? `
	<div class="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 px-5 py-4 text-center text-white shadow-lg shadow-slate-200">
	<p class="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Pre-game Timer</p>
	<p class="student-match-countdown mb-2 text-5xl font-black leading-none tracking-tighter"
	data-match-id="${match.id}" data-duration-seconds="${duration}"
	data-timer-enabled="${match.timer_enabled}" data-started-at="${match.timer_started_at || ''}">
	${formatTimerDisplay(remaining)}
	</p>
	<p class="text-xs text-slate-400 font-medium">
	${match.timer_enabled ? "The countdown is currently active." : "Waiting for the committee to start the timer."}
	</p>
	</div>
	` : ""}
	${history ? `
	<div class="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
	<h4 class="text-emerald-700 font-black uppercase text-[10px] tracking-widest mb-4">Final Match Result</h4>
	<div class="space-y-3">
	<div class="flex justify-between items-center bg-white/50 p-3 rounded-xl">
	<span class="text-sm font-bold text-slate-600">Winner</span>
	<span class="font-black text-emerald-700">${escapeHTML(history.winner_team_name)}</span>
	</div>
	<div class="flex justify-between items-center bg-white/50 p-3 rounded-xl">
	<span class="text-sm font-bold text-slate-600">Loser</span>
	<span class="font-black text-red-600">${escapeHTML(history.loser_team_name)}</span>
	</div>
	<div class="flex justify-between items-center bg-white/50 p-3 rounded-xl">
	<span class="text-sm font-bold text-slate-600">Player of the Game</span>
	<span class="font-black text-emerald-700 text-right">${escapeHTML(history.best_player || "Not recorded")}</span>
	</div>
	<p class="text-[10px] text-emerald-600 font-bold text-right pt-2">DECLARED AT: ${formatDateTime(history.declared_at)}</p>
	</div>
	</div>
	` : ""}
	</div>
	`;
	updateCountdownDisplays();
}

export function closeMatchDetails() {
	dom.matchDetailsModal.classList.add("hidden");
	dom.matchDetailsModal.classList.remove("flex");
}

// --- Schedule status filter --------------------------------------------------

export function setActiveScheduleFilter(val) {
	const selectedFilter = VALID_STUDENT_SCHEDULE_FILTERS.includes(val) ? val : "Next";
	state.activeScheduleFilter = selectedFilter;
	localStorage.setItem(STUDENT_SCHEDULE_FILTER_KEY, selectedFilter);
	document.querySelectorAll(".schedule-filter").forEach(btn => {
		const active = btn.dataset.scheduleFilter === selectedFilter;
		btn.className = active
			? "schedule-filter w-full min-w-0 sm:w-auto px-2 sm:px-6 py-2.5 rounded-full font-bold text-[11px] sm:text-sm transition-all duration-200 bg-blue-600 text-white shadow-md shadow-blue-100"
			: "schedule-filter w-full min-w-0 sm:w-auto px-2 sm:px-6 py-2.5 rounded-full font-bold text-[11px] sm:text-sm transition-all duration-200 bg-white border border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600";
	});
	renderMatches();
}
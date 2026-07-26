/*
 * Value normalisation helpers shared by every page.
 *
 * Everything in here turns messy database values (mixed case, stray
 * spaces, nulls, "TRUE"/"true"/true) into one canonical form so the pages
 * can compare them safely.
 *
 * NOTE: normalizeComparableValue and normalizeStatus are the same
 * function under two names. Both names are kept on purpose — different
 * pages call them for different concepts, and keeping the familiar names
 * makes the page code easier to follow. Do not "deduplicate" them by
 * renaming call sites.
 */

// The general-purpose normaliser: null-safe, trimmed, lowercased.
export function normalizeComparableValue(value) {
	return String(value ?? "").trim().toLowerCase();
}

// Same as above; the name used for match/attendance statuses.
export function normalizeStatus(value) {
	return String(value ?? "").trim().toLowerCase();
}

// Same again; the name used for team/sport name comparisons. Kept as its
// own function (rather than an alias) so its behaviour can never drift
// from the original.
export function normalizeText(value) {
	return String(value || "").trim().toLowerCase();
}

// Account approval status. Missing/empty counts as "pending".
export function normalizeAccountStatus(status) {
	return String(status || "pending").trim().toLowerCase();
}

// Participant review status. Missing/empty counts as "pending".
export function normalizeParticipantStatus(status) {
	return normalizeComparableValue(status || "pending");
}

// Sport game type: anything that is not clearly "minor" counts as "major".
export function normalizeGameType(value) {
	const normalized = String(value || "").trim().toLowerCase();
	return normalized === "minor" ? "minor" : "major";
}

// "Basketball - Boys" -> "basketballboys". Used to group sport categories
// like "Basketball Boys" and "Basketball Girls" under one "Basketball".
export function normalizeSportGroupKey(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

// "Basketball - Boys" -> "basketball boys". The spaced variant used by the
// committee match-scheduling permission checks.
export function normalizeSportText(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// Number() that can never produce NaN. Invalid values become 0.
export function toNumber(value) {
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : 0;
}

// "3, 7, 12" -> ["3", "7", "12"]. Sport ids are stored comma-joined in
// the participants table.
export function splitSportIdValues(value) {
	return String(value || "")
		.split(",")
		.map(item => item.trim())
		.filter(Boolean);
}
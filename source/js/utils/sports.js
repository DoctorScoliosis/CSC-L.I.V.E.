/*
 * Sport-category helpers shared by every page.
 *
 * The big one here is getGeneralSportName: it strips the category suffix
 * off a sport name so "Basketball Boys", "Basketball Girls" and
 * "Basketball - Mixed" all group under "Basketball". The Admin dashboard,
 * the login page, the Committee dashboard and the Student dashboard all
 * use it to build their sport group pickers.
 */

import { normalizeGameType } from "./normalize.js";

// Words that mark the start of a category suffix inside a sport name.
// e.g. in "Freestyle 100m Boys", "boys" starts the suffix, so the general
// name is "Freestyle 100m".
const CATEGORY_START_WORDS = new Set([
	"a", "b", "c", "d", "e",
	"boys", "boy", "girls", "girl",
	"men", "man", "mens", "male", "s",
	"women", "woman", "womens", "female",
	"mixed", "singles", "single", "doubles", "double",
	"relay", "backstroke", "butterfly", "freestyle",
	"division", "div", "category", "cat",
	"bracket", "pool", "group", "class"
]);

export function getGeneralSportName(name) {
	const cleanedName = String(name || "Unnamed sport")
		.replace(/\s+/g, " ")
		.trim();
	const normalizedName = cleanedName
		.replace(/[()']/g, " ")
		.replace(/[-:/]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const tokens = normalizedName.split(" ").filter(Boolean);
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index].toLowerCase();
		if (
			CATEGORY_START_WORDS.has(token)
			|| /^[a-e]$/i.test(token)
			|| /^\d/.test(token)
			|| /^\d+m$/i.test(token)
		) {
			return tokens.slice(0, index).join(" ") || cleanedName;
		}
	}
	return tokens.join(" ") || cleanedName;
}

// "minor" -> "Minor Game", everything else -> "Major Game".
export function getSportGameTypeLabel(value) {
	return normalizeGameType(value) === "minor" ? "Minor Game" : "Major Game";
}

// The registration limit per team for a sport. The fallback field names
// are historical; player_limit is the current column.
export function getSportPlayerLimit(sport) {
	const limit = Number(sport?.player_limit ?? sport?.players_per_team ?? sport?.max_players_per_team ?? 0);
	return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
}
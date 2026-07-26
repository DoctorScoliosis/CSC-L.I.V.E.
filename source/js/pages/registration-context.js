/*
 * Shared context for the CSC Cup registration page.
 *
 * Every registration feature module imports from here instead of passing
 * arguments around. Two mutable objects are exported:
 *
 *   state — runtime data (sports, teams, slot counts, flags)
 *   dom   — DOM element references, populated once by the orchestrator
 *           (registration.js) before any feature function is called.
 *
 * The Supabase client is the REGISTRATION flavour (default localStorage
 * persistence), NOT the dashboard sessionStorage client. See
 * supabase-client.js for why.
 */

import { getRegistrationClient } from "../supabase-client.js";

export const supabase = getRegistrationClient();

// --- Registration rule constants ---------------------------------------------
export const MAJOR_ONLY_LIMIT = 2;
export const MINOR_MIN = 1;
export const MINOR_LIMIT = 2;
export const MINOR_WITH_MAJOR_LIMIT = 1;
export const MAJOR_SELECTION_RULE_MESSAGE = "Players may choose 1 major game, or choose 2 major games as either 1 indoor and 1 outdoor, or 2 outdoor games only.";
export const REGISTRATION_SUCCESS_MESSAGE = "Your registration has been submitted successfully. The CSC will review your registration. If your registration is forfeited or rejected, your team president will be notified. If you do not receive any notice from your president, your registration will be considered approved.";

// --- Mutable runtime state ---------------------------------------------------
export const state = {
	sportsData: [],
	teamsData: [],
	registrationSlotCounts: [],
	isSyncingSportSlots: false,
	isSubmittingRegistration: false
};

// --- DOM references ----------------------------------------------------------
// Populated once by registration.js at init. Never accessed at module
// top-level — only inside functions that run after the orchestrator has
// queried the DOM.
export const dom = {};
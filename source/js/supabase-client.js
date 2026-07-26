/*
 * The single Supabase client for the whole site.
 *
 * Every page imports its client from here instead of creating one inline.
 * There are deliberately TWO clients, because the site has two different
 * auth situations:
 *
 *   supabase (the dashboard client)
 *     Used by index.html and the three dashboards. The session lives in
 *     sessionStorage under "csc-live-auth-session", which is what allows
 *     two tabs to hold two different accounts at once.
 *
 *   getRegistrationClient()
 *     Used ONLY by CSC-CUP-Form.html. Public student registration must
 *     not share (or disturb) the dashboard session, so it uses Supabase's
 *     default localStorage behaviour. It is created lazily, on first use,
 *     so dashboard pages never touch localStorage at all.
 *
 * If you change how either client is configured, change it here — this is
 * the only place it happens.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_STORAGE_KEY } from "./config.js";

// Dashboard client: login page + Admin + Committee + Student dashboards.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		storage: sessionStorage,
		storageKey: AUTH_STORAGE_KEY,
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true
	}
});

// Registration client: CSC-CUP-Form.html only. See the header comment for
// why this one is different.
let registrationClient = null;

export function getRegistrationClient() {
	if (!registrationClient) {
		registrationClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: {
				persistSession: true,
				autoRefreshToken: true
			}
		});
	}
	return registrationClient;
}
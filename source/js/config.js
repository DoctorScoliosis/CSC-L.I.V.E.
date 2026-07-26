/*
 * Central configuration for the whole CSC L.I.V.E. site.
 *
 * This is the ONLY place where the Supabase address, the anon key, the
 * table names and the storage buckets are written down. If the database
 * changes, or a new table is added, edit it here and every page picks it
 * up automatically. Before the refactor, every HTML page carried its own
 * copy of all of this.
 *
 * NOTE ON THE ANON KEY: it is meant to be public. Anyone visiting the
 * site can already read it out of the page source. Supabase security
 * comes from the Row Level Security policies in the database, NOT from
 * hiding this key. Do not "fix" it by moving it somewhere secret — it
 * would change nothing and break the site.
 */

// --- Supabase project ------------------------------------------------------
export const SUPABASE_URL = "https://unveyndaaznxgqojwjki.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudmV5bmRhYXpueGdxb2p3amtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MzQyNzUsImV4cCI6MjA5NDIxMDI3NX0.2RUriqqq9kITnl8uPZSdiSrXuo8BhD9nrzqHFUwl2yU";

// --- Auth / session ----------------------------------------------------------
// The dashboards keep their session in sessionStorage (one session per
// browser tab, so a tab can be signed in as admin while another tab is
// signed in as committee). "user" is the cached profile blob every page
// reads on load.
export const AUTH_STORAGE_KEY = "csc-live-auth-session";
export const SESSION_USER_KEY = "user";

// --- Database tables ---------------------------------------------------------
// Yes, teams really do live in a table called "sports_leaderboard".
// That name is historical; do not rename the table without a migration.
export const TEAMS_TABLE = "sports_leaderboard";
export const TEAM_NAME_COLUMN = "team";
export const PARTICIPANTS_TABLE = "participants";
export const PARTICIPANT_TEAM_COLUMN = "team";
export const MATCHES_TABLE = "scheduled_matches";
export const SPORTS_TABLE = "sports";
export const ATTENDANCE_TABLE = "attendance";
export const GAME_HISTORY_TABLE = "game_history";
export const BASKETBALL_STATS_TABLE = "basketball_match_player_stats";
export const STUDENT_FEEDBACK_TABLE = "student_feedback";
export const ANNOUNCEMENTS_TABLE = "announcements";
export const ACCOUNT_PROFILES_TABLE = "user_profiles";
export const CONVERSATIONS_TABLE = "conversations";
export const MESSAGES_TABLE = "messages";
export const CONVERSATION_SETTINGS_TABLE = "conversation_user_settings";
export const REGISTRATION_SLOT_COUNTS_VIEW = "registration_slot_counts";

// --- Storage buckets ---------------------------------------------------------
export const PARTICIPANT_DOCUMENTS_BUCKET = "participant-documents";
export const MESSAGE_ATTACHMENTS_BUCKET = "message-attachments";

// --- Special assignments -----------------------------------------------------
// A committee account can be assigned to "Overall Committee" instead of a
// real sport. The sentinel id below is what gets stored in
// user_profiles.assigned_sport_id for those accounts.
export const OVERALL_COMMITTEE_SPORT_ID = "__overall_committee__";
export const OVERALL_COMMITTEE_SPORT_NAME = "Overall Committee";
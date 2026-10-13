/* ============================================================
   CONFIG — the only file you edit with your Supabase credentials
   ============================================================ */

export const SUPABASE_URL      = 'https://xqrbwvyvuxxgfcuinxsk.supabase.co';
export const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY_HERE';

/* ---------- Anti-cheat ---------- */
// How many warnings before the quiz force-submits.
// Set to 3 → warnings 1 and 2 show, warning 3 = force submit.
export const MAX_WARNINGS        = 3;
// How many warnings the student is told they get.
// Shown as "Warning 1 of 2".
export const WARN_MESSAGE_COUNT  = 2;

// A network outage longer than this (seconds) counts as a suspicious
// disconnect and bumps the warning count.
export const OFFLINE_SUSPICIOUS_SECONDS = 120;

/* ---------- LocalStorage keys ---------- */
export const SESSION_KEY    = 'quiz_session_v1';       // current student attempt
export const QUEUE_KEY      = 'quiz_offline_queue_v1'; // unsent payloads
export const CLOSE_FLAG_KEY = 'quiz_close_flag_v1';    // "tab was closed" flag

/* ---------- App ---------- */
export const APP_NAME    = 'Quiz Platform Champ';
export const APP_VERSION = '1.0.0';

/* ---------- Admin Edge Function ---------- */
export const ADMIN_FN_URL = 'https://xqrbwvyvuxxgfcuinxsk.supabase.co/functions/v1/admin-users';
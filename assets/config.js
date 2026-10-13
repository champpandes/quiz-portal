/* ============================================================
   CONFIG — the only file you edit with your Supabase credentials
   ============================================================ */

export const SUPABASE_URL      = 'https://xqrbwvyvuxxgfcuinxsk.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxcmJ2d3l2dXh4Z2ZjdWlueHNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjY2NTcsImV4cCI6MjEwNjgwMjY1N30.XreL2WoENs7pjJ7_yX283oapMhDBC650LUTC9Q2VieU';

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
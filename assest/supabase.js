/* ============================================================
   SHARED SUPABASE CLIENT + HELPERS
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY,
  SESSION_KEY, QUEUE_KEY, CLOSE_FLAG_KEY,
} from './config.js';

/* ---------- client ---------- */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/* ============================================================
   STUDENT-SIDE RPCs
   ============================================================ */

/** Begin (or resume) an attempt. Returns the quiz payload. */
export async function startAttempt(code, studentNumber, studentName) {
  const { data, error } = await supabase.rpc('start_attempt', {
    p_quiz_code:      code,
    p_student_number: studentNumber,
    p_student_name:   studentName,
  });
  if (error) throw error;
  return data;
}

/** Save one answer. */
export async function saveAnswer(attemptId, attemptAnswerId, choiceId, secondsSpent) {
  const { error } = await supabase.rpc('save_answer', {
    p_attempt_id:         attemptId,
    p_attempt_answer_id:  attemptAnswerId,
    p_choice_id:          choiceId,
    p_seconds_spent:      secondsSpent,
  });
  if (error) throw error;
}

/** Log an anti-cheat event. Returns the new warning count. */
export async function logEvent(attemptId, eventType) {
  const { data, error } = await supabase.rpc('log_event', {
    p_attempt_id: attemptId,
    p_event_type: eventType,
  });
  if (error) throw error;
  return data; // integer
}

/** Submit and grade. */
export async function submitAttempt(attemptId, force = false) {
  const { data, error } = await supabase.rpc('submit_attempt', {
    p_attempt_id: attemptId,
    p_force:      force,
  });
  if (error) throw error;
  return data;
}

/** Mark the attempt abandoned (student closed the tab). */
export async function abandonAttempt(attemptId) {
  const { error } = await supabase.rpc('abandon_attempt', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
}

/* ============================================================
   AUTH (teacher pages)
   ============================================================ */

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/**
 * Call at the top of every protected admin page.
 * Redirects to the login page if not signed in.
 */
export async function requireAuth(loginPath = '../admin/index.html') {
  const session = await getSession();
  if (!session) {
    location.replace(loginPath);
    return null;
  }
  return session;
}

/* ============================================================
   LOCAL STORAGE HELPERS (offline safety)
   ============================================================ */

export function saveSession(obj) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(obj)); } catch (_) {}
}
export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch (_) { return null; }
}
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

export function queueOffline(body) {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    q.push(body);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (_) {}
}
export function drainQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    localStorage.removeItem(QUEUE_KEY);
    return q;
  } catch (_) { return []; }
}

export function setClosedFlag() {
  try { localStorage.setItem(CLOSE_FLAG_KEY, String(Date.now())); } catch (_) {}
}
export function consumeClosedFlag() {
  try {
    const v = localStorage.getItem(CLOSE_FLAG_KEY);
    localStorage.removeItem(CLOSE_FLAG_KEY);
    return v ? Number(v) : null;
  } catch (_) { return null; }
}

/* ============================================================
   FORMATTING
   ============================================================ */

export function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString();
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ============================================================
   SMALL UI HELPERS
   ============================================================ */

export function toast(msg, type = 'info', ms = 3000) {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__toast';
    el.style.cssText = `
      position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
      background:#111;color:#fff;padding:12px 18px;border-radius:10px;
      font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;
      transition:opacity .18s;max-width:90vw;text-align:center;`;
    document.body.appendChild(el);
  }
  if (type === 'error') el.style.background = '#b00020';
  else if (type === 'success') el.style.background = '#0a7d2c';
  else el.style.background = '#111';

  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.opacity = '0'; }, ms);
}
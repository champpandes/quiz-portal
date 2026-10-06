/* ============================================================
   SHARED SUPABASE CLIENT + HELPERS + THEME + SIDEBAR + ADMIN
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_FN_URL,
  SESSION_KEY, QUEUE_KEY, CLOSE_FLAG_KEY,
} from './config.js';

/* ============================================================
   THEME
   ============================================================ */

const THEME_KEY = 'quiz_theme_v1';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (_) {}
    if (!stored) applyTheme(e.matches ? 'dark' : 'light');
  });
}

/* ============================================================
   SUPABASE CLIENT (created early — needed by the sidebar check)
   ============================================================ */

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/* ============================================================
   SIDEBAR
   ============================================================ */

const NAV_ICONS = {
  'dashboard.html': '📊',
  'subjects.html':  '📚',
  'questions.html': '❓',
  'quizzes.html':   '📝',
  'settings.html':  '⚙️',
  'users.html':     '👤',
};

let _sidebarNav = null;

function buildSidebar() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return false;

  const navLinks = [...topbar.querySelectorAll('nav a')];
  const userEl   = topbar.querySelector('.user');

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'adminSidebar';

  const brand = document.createElement('a');
  brand.className = 'sidebar-brand';
  brand.href = 'dashboard.html';
  brand.innerHTML = `
    <img src="../assets/logo-icon.svg" alt="" width="30" height="30">
    <span>Quiz Platform <strong>Champ</strong></span>
  `;
  sidebar.appendChild(brand);

  const nav = document.createElement('nav');
  nav.className = 'sidebar-nav';
  navLinks.forEach(a => {
    const href = a.getAttribute('href') || '';
    const link = document.createElement('a');
    link.href = href;
    if (a.classList.contains('active')) link.classList.add('active');
    link.innerHTML = `
      <span class="ico">${NAV_ICONS[href] || '•'}</span>
      <span>${a.textContent.trim()}</span>
    `;
    nav.appendChild(link);
  });
  sidebar.appendChild(nav);
  _sidebarNav = nav;

  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';

  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'theme-toggle';
  themeBtn.setAttribute('aria-label', 'Toggle dark mode');
  themeBtn.innerHTML = `
    <span class="ico-moon">🌙</span>
    <span class="ico-sun">☀️</span>
    <span class="label-dark">Dark mode</span>
    <span class="label-light">Light mode</span>
  `;
  themeBtn.addEventListener('click', toggleTheme);
  footer.appendChild(themeBtn);

  if (userEl) footer.appendChild(userEl);
  sidebar.appendChild(footer);

  document.body.insertBefore(sidebar, document.body.firstChild);
  topbar.remove();

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'mobile-menu-btn';
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.innerHTML = '☰';

  const overlay = document.createElement('div');
  overlay.className = 'mobile-overlay';

  document.body.appendChild(menuBtn);
  document.body.appendChild(overlay);

  const openSidebar = () => {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    document.body.classList.add('sidebar-open');
  };
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  };

  menuBtn.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeSidebar));

  return true;
}

async function addSuperadminLink() {
  if (!_sidebarNav) return;
  if (_sidebarNav.querySelector('a[href="users.html"]')) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, disabled')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'superadmin' || profile.disabled) return;

    const link = document.createElement('a');
    link.href = 'users.html';
    const current = location.pathname.split('/').pop();
    if (current === 'users.html') link.classList.add('active');
    link.innerHTML = `
      <span class="ico">👤</span>
      <span>Users</span>
    `;
    link.style.animation = 'fadeInUp .3s ease-out both';
    _sidebarNav.appendChild(link);
  } catch (_) { /* silent */ }
}

function injectFloatingToggle() {
  if (document.querySelector('.theme-toggle-float')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle-float';
  btn.setAttribute('aria-label', 'Toggle dark mode');
  btn.innerHTML = `
    <span class="ico-moon">🌙</span>
    <span class="ico-sun">☀️</span>
  `;
  btn.addEventListener('click', toggleTheme);
  document.body.appendChild(btn);
}

function initLayout() {
  initTheme();
  const run = () => {
    const built = buildSidebar();
    if (!built) injectFloatingToggle();
    else addSuperadminLink();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}

initLayout();

/* ============================================================
   ADMIN EDGE FUNCTION (superadmin only)
   ============================================================ */

export async function callAdminFn(action, payload = {}) {
  if (!ADMIN_FN_URL || ADMIN_FN_URL.includes('PASTE_')) {
    throw new Error('Admin function URL not set in config.js');
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const res = await fetch(ADMIN_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function isSuperadmin() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const { data } = await supabase
      .from('profiles')
      .select('role, disabled')
      .eq('id', session.user.id)
      .single();
    return !!data && data.role === 'superadmin' && !data.disabled;
  } catch (_) { return false; }
}

/* ============================================================
   STUDENT RPCs
   ============================================================ */

export async function startAttempt(code, studentNumber, studentName) {
  const { data, error } = await supabase.rpc('start_attempt', {
    p_quiz_code:      code,
    p_student_number: studentNumber,
    p_student_name:   studentName,
  });
  if (error) throw error;
  return data;
}

export async function saveAnswer(attemptId, attemptAnswerId, choiceId, secondsSpent) {
  const { error } = await supabase.rpc('save_answer', {
    p_attempt_id:         attemptId,
    p_attempt_answer_id:  attemptAnswerId,
    p_choice_id:          choiceId,
    p_seconds_spent:      secondsSpent,
  });
  if (error) throw error;
}

export async function logEvent(attemptId, eventType) {
  const { data, error } = await supabase.rpc('log_event', {
    p_attempt_id: attemptId,
    p_event_type: eventType,
  });
  if (error) throw error;
  return data;
}

export async function submitAttempt(attemptId, force = false) {
  const { data, error } = await supabase.rpc('submit_attempt', {
    p_attempt_id: attemptId,
    p_force:      force,
  });
  if (error) throw error;
  return data;
}

export async function abandonAttempt(attemptId) {
  const { error } = await supabase.rpc('abandon_attempt', {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
}

/* ============================================================
   AUTH
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

export async function requireAuth(loginPath = '../admin/index.html') {
  const session = await getSession();
  if (!session) {
    location.replace(loginPath);
    return null;
  }
  // reject disabled accounts
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('disabled')
      .eq('id', session.user.id)
      .single();
    if (profile?.disabled) {
      await supabase.auth.signOut();
      alert('Your account has been disabled. Please contact the administrator.');
      location.replace(loginPath);
      return null;
    }
  } catch (_) { /* profile missing — allow through, migration may have missed this user */ }
  return session;
}

/* ============================================================
   LOCAL STORAGE
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
  return new Date(iso).toLocaleString();
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ============================================================
   TOAST
   ============================================================ */

export function toast(msg, type = 'info', ms = 3000) {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__toast';
    el.style.cssText = `
      position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);
      background:#111;color:#fff;padding:13px 20px;border-radius:10px;
      font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      font-weight:500;z-index:9999;box-shadow:0 12px 32px rgba(0,0,0,.35);
      opacity:0;transition:opacity .2s, transform .2s;max-width:90vw;text-align:center;
      pointer-events:none;`;
    document.body.appendChild(el);
  }
  if (type === 'error') el.style.background = '#b00020';
  else if (type === 'success') el.style.background = '#0a7d2c';
  else el.style.background = '#111';

  el.textContent = msg;
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(el.__t);
  el.__t = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
  }, ms);
}
/* ============================================================
   STUDENT QUIZ ENGINE
   ============================================================ */

import {
  startAttempt, saveAnswer, logEvent, submitAttempt,
  escapeHtml, fmtTime,
} from './supabase.js';
import {
  MAX_WARNINGS, WARN_MESSAGE_COUNT,
  SESSION_KEY, CLOSE_FLAG_KEY,
} from './config.js';

let state = null;
let elapsedTimer = null;
let questionShownAt = 0;
let lastWarningAt = 0;
let modalOpen = false;
let submitting = false;

const $ = id => document.getElementById(id);

function showScreen(name) {
  ['entry','loading','quiz','done','error'].forEach(s => {
    const el = $('screen-' + s);
    if (el) el.classList.toggle('active', s === name);
  });
  $('bottomBar').classList.toggle('hidden', name !== 'quiz');
}

function showError(msg, icon = '⚠️') {
  $('errIcon').textContent = icon;
  $('errMsg').textContent = msg;
  showScreen('error');
}

/* ---------- close flag ---------- */
function setCloseFlag() {
  try { localStorage.setItem(CLOSE_FLAG_KEY, JSON.stringify({ at: Date.now() })); } catch (_) {}
}
function consumeCloseFlag() {
  try {
    const raw = localStorage.getItem(CLOSE_FLAG_KEY);
    localStorage.removeItem(CLOSE_FLAG_KEY);
    if (!raw) return null;
    const { at } = JSON.parse(raw);
    if (!at) return null;
    if (Date.now() - at > 24 * 3600 * 1000) return null;
    return at;
  } catch (_) { return null; }
}

/* ---------- persistence ---------- */
function saveLocal() {
  if (!state) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      attemptId: state.attemptId,
      current: state.current,
      warningCount: state.warningCount,
      startedAt: state.startedAt,
    }));
  } catch (_) {}
}
function clearLocal() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

/* ---------- start ---------- */
async function beginQuiz(code, studentNumber, studentName) {
  showScreen('loading');
  try {
    const data = await startAttempt(code, studentNumber, studentName);

    state = {
      attemptId:        data.attempt_id,
      quizTitle:        data.quiz_title,
      showScore:        data.show_score_at_end,
      totalQuestions:   data.total_questions,
      current:          0,
      warningCount:     0,
      startedAt:        Date.now(),
      questions:        (data.questions || []).map(q => ({
        aa_id:             q.aa_id,
        text:              q.text,
        passage:           q.passage || null,
        choices:           q.choices || [],
        selectedChoiceId:  q.selected_choice_id || null,
        secondsSpent:      q.seconds_spent || 0,
      })),
    };

    if (!state.questions.length) {
      showError('This quiz has no questions yet. Please tell your teacher.');
      return;
    }

    $('quizTitle').textContent = state.quizTitle;

    const priorClose = consumeCloseFlag();
    if (priorClose) {
      try {
        const cnt = await logEvent(state.attemptId, 'tab_closed');
        state.warningCount = cnt;
      } catch (_) { state.warningCount = 1; }
    }

    startElapsedTimer();
    installAntiCheat();
    renderQuestion();
    showScreen('quiz');
    saveLocal();
  } catch (err) {
    const msg = err?.message || String(err);
    if (/not found/i.test(msg))         showError('Quiz not found. Check the link your teacher shared.', '🔍');
    else if (/not active/i.test(msg))   showError('This quiz is not currently active. Please contact your teacher.', '⏸️');
    else if (/not open yet/i.test(msg)) showError('This quiz is not open yet. Please come back later or ask your teacher.', '🕒');
    else if (/expired/i.test(msg))      showError('This quiz has expired. Please contact your teacher.', '⏰');
    else                                 showError('Could not start the quiz: ' + msg, '⚠️');
  }
}

/* ---------- timer ---------- */
function startElapsedTimer() {
  clearInterval(elapsedTimer);
  updateTimerDisplay();
  elapsedTimer = setInterval(updateTimerDisplay, 1000);
}
function updateTimerDisplay() {
  if (!state) return;
  $('timer').textContent = fmtTime(Math.floor((Date.now() - state.startedAt) / 1000));
}

/* ---------- render ---------- */
function renderQuestion() {
  const i = state.current;
  const q = state.questions[i];
  const total = state.questions.length;

  $('qCounter').textContent = `Question ${i + 1} of ${total}`;
  $('progressFill').style.width = ((i) / total * 100) + '%';

  // passage (if any)
  const pBox = $('passageBox');
  if (q.passage) {
    $('passageTitle').textContent = q.passage.title || '';
    $('passageTitle').style.display = q.passage.title ? 'block' : 'none';
    $('passageText').textContent = q.passage.text || '';
    pBox.style.display = 'block';
  } else {
    pBox.style.display = 'none';
  }

  $('questionText').textContent = q.text;

  const box = $('choices');
  box.innerHTML = '';
  const letters = ['A','B','C','D','E','F','G','H'];
  q.choices.forEach((c, idx) => {
    const el = document.createElement('div');
    el.className = 'choice' + (q.selectedChoiceId === c.id ? ' selected' : '');
    el.innerHTML = `
      <div class="letter">${letters[idx] || '·'}</div>
      <div class="txt">${escapeHtml(c.text)}</div>
    `;
    el.addEventListener('click', () => pickChoice(c.id));
    box.appendChild(el);
  });

  const isLast = i === total - 1;
  $('btnNext').textContent = isLast ? 'Submit' : 'Next';
  $('btnNext').disabled = !q.selectedChoiceId;

  updateWarningUI();
  questionShownAt = Date.now();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateWarningUI() {
  const el = $('warnBadge');
  if (!state || state.warningCount <= 0) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = `⚠ ${state.warningCount} warning${state.warningCount === 1 ? '' : 's'}`;
  }
}

/* ---------- answer ---------- */
async function pickChoice(choiceId) {
  const q = state.questions[state.current];
  if (q.selectedChoiceId === choiceId) return;
  q.selectedChoiceId = choiceId;

  document.querySelectorAll('.choice').forEach((el, i) => {
    el.classList.toggle('selected', q.choices[i].id === choiceId);
  });
  $('btnNext').disabled = false;
  saveLocal();

  const sec = Math.max(1, Math.round((Date.now() - questionShownAt) / 1000));
  try { await saveAnswer(state.attemptId, q.aa_id, choiceId, sec); } catch (_) {}
}

async function handleNext() {
  const q = state.questions[state.current];
  if (!q.selectedChoiceId) return;

  const sec = Math.max(1, Math.round((Date.now() - questionShownAt) / 1000));
  try { await saveAnswer(state.attemptId, q.aa_id, q.selectedChoiceId, sec); } catch (_) {}

  if (state.current < state.questions.length - 1) {
    state.current++;
    saveLocal();
    renderQuestion();
  } else {
    await doSubmit(false);
  }
}

/* ---------- submit ---------- */
async function doSubmit(forced) {
  if (submitting) return;
  submitting = true;
  clearInterval(elapsedTimer);
  removeAntiCheat();

  $('btnNext').disabled = true;
  $('btnNext').textContent = 'Submitting…';

  try {
    const res = await submitAttempt(state.attemptId, forced);
    clearLocal();
    showDone(res, forced);
  } catch (err) {
    $('btnNext').disabled = false;
    $('btnNext').textContent = 'Submit';
    submitting = false;
    alert('Could not submit: ' + err.message + '\n\nPlease try again or tell your teacher.');
  }
}

function showDone(res, forced) {
  const { score, total, percent } = res;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);

  $('doneIcon').textContent = forced ? '⚠️' : '✅';
  $('doneTitle').textContent = forced ? 'Quiz Submitted' : 'Submitted Successfully';
  $('doneSub').textContent = forced
    ? 'Your quiz was submitted automatically because of repeated warnings.'
    : 'Your answers have been sent to your teacher.';

  if (state.showScore && score != null) {
    $('doneScore').style.display = 'block';
    $('doneScore').textContent = `${score} / ${total}`;
    $('donePercent').textContent = `${percent}%`;
  } else {
    $('doneScore').style.display = 'none';
    $('donePercent').textContent = 'Your score will be shown by your teacher.';
  }

  $('doneTime').textContent = `Time used: ${fmtTime(elapsed)}`;
  showScreen('done');
}

/* ---------- anti-cheat ---------- */
function installAntiCheat() {
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('contextmenu', blockEvent);
  document.addEventListener('copy', blockEvent);
  document.addEventListener('cut', blockEvent);
  document.addEventListener('paste', blockEvent);
  document.addEventListener('selectstart', blockSelect);
  history.pushState({ quiz: true }, '', location.href);
  window.addEventListener('popstate', onPopState);
}

function removeAntiCheat() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('contextmenu', blockEvent);
  document.removeEventListener('copy', blockEvent);
  document.removeEventListener('cut', blockEvent);
  document.removeEventListener('paste', blockEvent);
  document.removeEventListener('selectstart', blockSelect);
  window.removeEventListener('popstate', onPopState);
}

function blockEvent(e) { e.preventDefault(); }
function blockSelect(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
}

function onVisibility() { if (document.hidden) triggerWarning('tab_hidden'); }
function onBlur() { triggerWarning('window_blur'); }
function onPopState() {
  history.pushState({ quiz: true }, '', location.href);
  triggerWarning('back_button');
}
function onPageHide() { if (state && !submitting) setCloseFlag(); }

async function triggerWarning(reason) {
  if (!state || submitting || modalOpen) return;
  if (Date.now() - lastWarningAt < 2500) return;
  lastWarningAt = Date.now();

  let newCount = state.warningCount + 1;
  try { newCount = await logEvent(state.attemptId, reason); } catch (_) {}
  state.warningCount = newCount;
  updateWarningUI();
  saveLocal();

  modalOpen = true;
  showWarningModal(newCount, newCount >= MAX_WARNINGS);
}

function showWarningModal(count, isFinal) {
  const remaining = Math.max(0, MAX_WARNINGS - count);
  $('warnCount').textContent = `Warning ${count} of ${WARN_MESSAGE_COUNT}`;
  if (isFinal) {
    $('warnBody').innerHTML = `You have reached the warning limit. Your quiz will be submitted now.`;
  } else {
    $('warnBody').innerHTML =
      `Leaving this page is not allowed. ` +
      `<br><span class="danger">${remaining} warning${remaining === 1 ? '' : 's'} left before your quiz is submitted automatically.</span>`;
  }
  $('modalWarning').classList.remove('hidden');
}

$('btnWarnOk').addEventListener('click', async () => {
  $('modalWarning').classList.add('hidden');
  modalOpen = false;
  if (state.warningCount >= MAX_WARNINGS) await doSubmit(true);
});

/* ---------- boot ---------- */
(async function boot() {
  $('btnStart').addEventListener('click', () => {
    const num = $('inStudentNo').value.trim();
    const name = $('inName').value.trim();
    if (!num) { $('entryErr').textContent = 'Enter your student number.'; $('entryErr').classList.remove('hidden'); return; }
    if (!name) { $('entryErr').textContent = 'Enter your full name.'; $('entryErr').classList.remove('hidden'); return; }
    try { localStorage.setItem('quiz_last_student', num); } catch (_) {}
    beginQuiz(window.__QUIZ_CODE__, num, name);
  });

  try {
    const last = localStorage.getItem('quiz_last_student');
    if (last) $('inStudentNo').value = last;
  } catch (_) {}

  $('inName').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnStart').click(); });
  $('inStudentNo').addEventListener('keydown', e => { if (e.key === 'Enter') $('inName').focus(); });

  $('btnNext').addEventListener('click', handleNext);
  $('entryErr').classList.add('hidden');
})();
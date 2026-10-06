/* ============================================================
   STUDENT QUIZ ENGINE — with review screen
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
  ['entry','loading','quiz','review','done','error'].forEach(s => {
    const el = $('screen-' + s);
    if (el) el.classList.toggle('active', s === name);
  });
  // bottom bar visible on both quiz and review
  const showBar = (name === 'quiz' || name === 'review');
  $('bottomBar').classList.toggle('hidden', !showBar);
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
      mode: state.mode,
      editingFromReview: state.editingFromReview,
      startedAt: state.startedAt,
    }));
  } catch (_) {}
}
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch (_) { return null; }
}
function clearLocal() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

/* ============================================================
   START
   ============================================================ */
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
      mode:             'quiz',           // 'quiz' | 'review'
      editingFromReview: false,
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

    $('quizTitle').textContent  = state.quizTitle;
    $('reviewTitle').textContent = state.quizTitle;

    /* restore saved progress if this attempt is the same one */
    const saved = loadLocal();
    if (saved && saved.attemptId === data.attempt_id) {
      state.current = Math.min(
        Math.max(0, saved.current || 0),
        state.questions.length - 1
      );
      state.mode = saved.mode === 'review' ? 'review' : 'quiz';
      state.editingFromReview = !!saved.editingFromReview;
      if (saved.startedAt) state.startedAt = saved.startedAt;
    }

    /* tab-close warning */
    const priorClose = consumeCloseFlag();
    if (priorClose) {
      try {
        const cnt = await logEvent(state.attemptId, 'tab_closed');
        state.warningCount = cnt;
      } catch (_) { state.warningCount = 1; }
    }

    startElapsedTimer();
    installAntiCheat();
    render();
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

/* ============================================================
   TIMER
   ============================================================ */
function startElapsedTimer() {
  clearInterval(elapsedTimer);
  updateTimerDisplay();
  elapsedTimer = setInterval(updateTimerDisplay, 1000);
}
function updateTimerDisplay() {
  if (!state) return;
  $('timer').textContent = fmtTime(Math.floor((Date.now() - state.startedAt) / 1000));
}

/* ============================================================
   RENDER ROUTER
   ============================================================ */
function render() {
  if (state.mode === 'review') {
    renderReview();
    showScreen('review');
  } else {
    renderQuestion();
    showScreen('quiz');
  }
  updateWarningUI();
  updateBottomBar();
}

/* ============================================================
   QUESTION VIEW
   ============================================================ */
function renderQuestion() {
  const i = state.current;
  const q = state.questions[i];
  const total = state.questions.length;

  $('qCounter').textContent = `Question ${i + 1} of ${total}`;
  $('progressFill').style.width = ((i) / total * 100) + '%';

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

  questionShownAt = Date.now();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   REVIEW VIEW
   ============================================================ */
function renderReview() {
  const list = $('reviewList');

  list.innerHTML = state.questions.map((q, i) => {
    const answered = q.selectedChoiceId != null;
    const chosen = q.choices.find(c => c.id === q.selectedChoiceId);
    const answerText = chosen?.text || '';
    const fromPassage = q.passage
      ? `<div class="review-passage">📄 ${escapeHtml(q.passage.title || 'Passage')}</div>`
      : '';

    return `
      <div class="review-item ${answered ? '' : 'unanswered'}">
        <div class="review-num">Q${i + 1}</div>
        <div class="review-content">
          ${fromPassage}
          <div class="review-q">${escapeHtml(q.text)}</div>
          <div class="review-a">
            ${answered
              ? `Your answer: <strong>${escapeHtml(answerText)}</strong>`
              : `<span class="not-answered">Not answered yet</span>`}
          </div>
        </div>
        <button class="ghost small" data-edit="${i}">Edit</button>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.edit, 10);
      goToQuestion(idx, true);
    });
  });

  // count unanswered for the summary
  const unanswered = state.questions.filter(q => !q.selectedChoiceId).length;
  const summary = unanswered > 0
    ? `<div class="review-summary warn">
         ${unanswered} question${unanswered === 1 ? '' : 's'} still unanswered.
         You can still submit, but you'll be asked to confirm.
       </div>`
    : `<div class="review-summary ok">
         All questions answered. Ready to submit!
       </div>`;

  // put summary above the list
  const existing = list.parentElement.querySelector('.review-summary');
  if (existing) existing.remove();
  list.insertAdjacentHTML('beforebegin', summary);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goToQuestion(idx, fromReview = false) {
  state.current = Math.min(Math.max(0, idx), state.questions.length - 1);
  state.mode = 'quiz';
  state.editingFromReview = fromReview;
  saveLocal();
  render();
}

function goToReview() {
  state.mode = 'review';
  state.editingFromReview = false;
  saveLocal();
  render();
}

/* ============================================================
   BOTTOM BAR
   ============================================================ */
function updateBottomBar() {
  const btn = $('btnNext');
  if (!state) return;

  if (state.mode === 'review') {
    btn.textContent = 'Submit quiz';
    btn.disabled = false;
    return;
  }

  const q = state.questions[state.current];
  const answered = q.selectedChoiceId != null;

  if (state.editingFromReview) {
    btn.textContent = 'Save & back to review';
    btn.disabled = !answered;
    return;
  }

  const isLast = state.current === state.questions.length - 1;
  btn.textContent = isLast ? 'Review answers' : 'Next';
  btn.disabled = !answered;
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

/* ============================================================
   ANSWER PICK
   ============================================================ */
async function pickChoice(choiceId) {
  const q = state.questions[state.current];
  if (q.selectedChoiceId === choiceId) return;
  q.selectedChoiceId = choiceId;

  document.querySelectorAll('.choice').forEach((el, i) => {
    el.classList.toggle('selected', q.choices[i].id === choiceId);
  });

  updateBottomBar();
  saveLocal();

  const sec = Math.max(1, Math.round((Date.now() - questionShownAt) / 1000));
  try { await saveAnswer(state.attemptId, q.aa_id, choiceId, sec); } catch (_) {}
}

/* ============================================================
   NEXT / SUBMIT
   ============================================================ */
async function handleNext() {
  // in review mode → submit
  if (state.mode === 'review') {
    const unanswered = state.questions.filter(q => !q.selectedChoiceId).length;
    if (unanswered > 0) {
      const ok = confirm(
        `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}.\n\n` +
        `Submit anyway?`
      );
      if (!ok) return;
    }
    await doSubmit(false);
    return;
  }

  // in quiz mode → save & move
  const q = state.questions[state.current];
  if (!q.selectedChoiceId) return;

  const sec = Math.max(1, Math.round((Date.now() - questionShownAt) / 1000));
  try { await saveAnswer(state.attemptId, q.aa_id, q.selectedChoiceId, sec); } catch (_) {}

  if (state.editingFromReview) {
    goToReview();
    return;
  }

  if (state.current < state.questions.length - 1) {
    goToQuestion(state.current + 1, false);
  } else {
    goToReview();
  }
}

/* ============================================================
   SUBMIT
   ============================================================ */
async function doSubmit(forced) {
  if (submitting) return;
  submitting = true;
  clearInterval(elapsedTimer);
  removeAntiCheat();

  const btn = $('btnNext');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await submitAttempt(state.attemptId, forced);
    clearLocal();
    showDone(res, forced);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = state.mode === 'review' ? 'Submit quiz' : 'Next';
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

/* ============================================================
   ANTI-CHEAT
   ============================================================ */
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
function onBlur()       { triggerWarning('window_blur'); }
function onPopState() {
  history.pushState({ quiz: true }, '', location.href);
  triggerWarning('back_button');
}
function onPageHide()   { if (state && !submitting) setCloseFlag(); }

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

/* ============================================================
   BOOT
   ============================================================ */
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
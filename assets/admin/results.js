/* ============================================================
   RESULTS — quiz attempts, per-student detail, exports
   ============================================================ */

import { supabase } from '../supabase.js';

/* ---------- quiz + attempts ---------- */
export async function getQuiz(quizId) {
  const { data, error } = await supabase
    .from('quizzes')
    .select(`
      id, title, code, num_questions, is_active, created_at, opens_at, expires_at,
      show_score_at_end, shuffle_questions, shuffle_choices,
      subject_id, period_id,
      subjects(id, name),
      periods(id, name)
    `)
    .eq('id', quizId)
    .single();
  if (error) throw error;
  return data;
}

export async function listAttempts(quizId) {
  const { data, error } = await supabase
    .from('attempts')
    .select(`
      id, student_number, student_name,
      started_at, submitted_at, duration_seconds,
      score, total_questions, percent,
      warning_count, submitted, abandoned, force_submitted,
      is_kept, is_flagged, duplicate_of
    `)
    .eq('quiz_id', quizId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getAttemptDetail(attemptId) {
  const { data: attempt, error: aErr } = await supabase
    .from('attempts')
    .select('*')
    .eq('id', attemptId)
    .single();
  if (aErr) throw aErr;

  const { data: answers, error: ansErr } = await supabase
    .from('attempt_answers')
    .select(`
      id, question_id, choice_id, is_correct, seconds_spent,
      question_order, answered_at,
      questions ( id, text, choices ( id, text, is_correct, position ) )
    `)
    .eq('attempt_id', attemptId)
    .order('question_order', { ascending: true });
  if (ansErr) throw ansErr;

  const { data: events, error: eErr } = await supabase
    .from('anti_cheat_events')
    .select('id, event_type, at')
    .eq('attempt_id', attemptId)
    .order('at', { ascending: true });
  if (eErr) throw eErr;

  return { attempt, answers: answers || [], events: events || [] };
}

/* ---------- mutations ---------- */
export async function setKept(attemptId, isKept) {
  const { data: attempt, error: getErr } = await supabase
    .from('attempts')
    .select('quiz_id, student_number')
    .eq('id', attemptId)
    .single();
  if (getErr) throw getErr;

  const { error: clearErr } = await supabase
    .from('attempts')
    .update({ is_kept: false })
    .eq('quiz_id', attempt.quiz_id)
    .eq('student_number', attempt.student_number);
  if (clearErr) throw clearErr;

  if (isKept) {
    const { error: setErr } = await supabase
      .from('attempts')
      .update({ is_kept: true })
      .eq('id', attemptId);
    if (setErr) throw setErr;
  }
}

export async function setFlagged(attemptId, isFlagged) {
  const { error } = await supabase
    .from('attempts')
    .update({ is_flagged: isFlagged })
    .eq('id', attemptId);
  if (error) throw error;
}

export async function deleteAttempt(attemptId) {
  const { error } = await supabase.from('attempts').delete().eq('id', attemptId);
  if (error) throw error;
}

/* ============================================================
   EXPORTS — flattening
   ============================================================ */

/** Flatten attempts into rows for CSV / Excel / Sheets. */
export function flattenAttempts(attempts) {
  return attempts.map(a => ({
    student_number: a.student_number,
    student_name: a.student_name,
    score: a.score ?? '',
    total: a.total_questions,
    percent: a.percent ?? '',
    warnings: a.warning_count,
    time_seconds: a.duration_seconds ?? '',
    time_display: fmtDuration(a.duration_seconds),
    force_submitted: a.force_submitted ? 'yes' : '',
    abandoned: a.abandoned ? 'yes' : '',
    is_flagged: a.is_flagged ? 'yes' : '',
    is_kept: a.is_kept ? 'yes' : '',
    started_at: a.started_at,
    submitted_at: a.submitted_at || '',
  }));
}

/** One row per question per attempt — for deep review. */
export function flattenDetailedAnswers(attempt, answers) {
  if (!attempt || !answers || !answers.length) return [];
  const studentName = attempt.student_name || '';
  const studentNumber = attempt.student_number || '';

  return answers.map((ans, i) => {
    const q = ans.questions;
    const chosen = q?.choices?.find(c => c.id === ans.choice_id);
    const correct = q?.choices?.find(c => c.is_correct);

    return {
      student_number: studentNumber,
      student_name: studentName,
      question_no: i + 1,
      question: q?.text || '',
      student_answer: chosen?.text || '(no answer)',
      correct_answer: correct?.text || '',
      is_correct: ans.is_correct ? 'yes' : 'no',
      seconds_spent: ans.seconds_spent || 0,
      attempt_score: attempt.score ?? '',
      attempt_percent: attempt.percent ?? '',
      attempt_warnings: attempt.warning_count ?? 0,
      attempt_started: attempt.started_at || '',
    };
  });
}

function fmtDuration(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2,'0')}s`;
}

/* ============================================================
   DOWNLOAD HELPERS
   ============================================================ */

/** Download as CSV. */
export function downloadCSV(rows, filename) {
  if (!rows.length) { alert('No rows to export.'); return; }
  const headers = Object.keys(rows[0]);
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : filename + '.csv');
}

/** Download as Excel (.xlsx). Requires SheetJS on the page. */
export function downloadXLSX(rows, filename, sheetName = 'Results') {
  if (!rows.length) { alert('No rows to export.'); return; }
  if (typeof window.XLSX === 'undefined') {
    alert('Excel library not loaded. Please try CSV instead.');
    return;
  }
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
  window.XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   COPY TO CLIPBOARD (TSV — pastes perfectly into Google Sheets)
   ============================================================ */

export async function copyAsTSV(rows) {
  if (!rows.length) throw new Error('No rows to copy');

  const headers = Object.keys(rows[0]);
  const escapeCell = v => {
    const s = String(v ?? '');
    // TSV can't contain literal tabs or newlines inside cells
    return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  };

  const lines = [
    headers.join('\t'),
    ...rows.map(r => headers.map(h => escapeCell(r[h])).join('\t')),
  ];
  const tsv = lines.join('\n');

  try {
    await navigator.clipboard.writeText(tsv);
    return true;
  } catch (_) {
    // Fallback for browsers without clipboard permission
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('Copy failed — your browser blocked clipboard access');
    return true;
  }
}
/* ============================================================
   RESULTS — quiz attempts, per-student detail, exports
   ============================================================ */

import { supabase } from '../supabase.js';

/* ---------- quiz + attempts ---------- */
export async function getQuiz(quizId) {
  const { data, error } = await supabase
    .from('quizzes')
    .select(`
      id, title, code, num_questions, is_active, created_at, expires_at,
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
  // clear is_kept on all other attempts by same student for same quiz,
  // then set it on this one if isKept = true
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
   EXPORTS
   ============================================================ */

/** Flatten attempts into rows for CSV / Excel. */
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

function fmtDuration(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2,'0')}s`;
}

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
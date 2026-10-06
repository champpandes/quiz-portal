/* ============================================================
   QUESTIONS + CHOICES + BULK IMPORT
   ============================================================ */

import { supabase } from '../supabase.js';

/* ---------- reads ---------- */
export async function listSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, periods(id, name)')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function listQuestions(periodId) {
  const { data, error } = await supabase
    .from('questions')
    .select('id, text, created_at, served_count, choices(id, text, is_correct, position)')
    .eq('period_id', periodId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/* ---------- writes ---------- */
export async function createQuestion(periodId, text, choices) {
  const { data: q, error: qErr } = await supabase
    .from('questions')
    .insert({ period_id: periodId, text })
    .select()
    .single();
  if (qErr) throw qErr;

  const rows = choices.map((c, i) => ({
    question_id: q.id,
    text: c.text,
    is_correct: !!c.is_correct,
    position: i,
  }));
  const { error: cErr } = await supabase.from('choices').insert(rows);
  if (cErr) {
    await supabase.from('questions').delete().eq('id', q.id);
    throw cErr;
  }
  return q;
}

export async function updateQuestion(questionId, text, choices) {
  const { error: qErr } = await supabase
    .from('questions')
    .update({ text })
    .eq('id', questionId);
  if (qErr) throw qErr;

  const { error: dErr } = await supabase
    .from('choices')
    .delete()
    .eq('question_id', questionId);
  if (dErr) throw dErr;

  const rows = choices.map((c, i) => ({
    question_id: questionId,
    text: c.text,
    is_correct: !!c.is_correct,
    position: i,
  }));
  const { error: cErr } = await supabase.from('choices').insert(rows);
  if (cErr) throw cErr;
}

export async function deleteQuestion(id) {
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) throw error;
}

export async function deletePeriodQuestions(periodId) {
  const { error } = await supabase.from('questions').delete().eq('period_id', periodId);
  if (error) throw error;
}

/* ---------- bulk insert ---------- */
export async function bulkInsert(periodId, rows) {
  if (!rows.length) return 0;

  const qRows = rows.map(r => ({ period_id: periodId, text: r.text }));
  const { data: inserted, error: qErr } = await supabase
    .from('questions')
    .insert(qRows)
    .select('id');
  if (qErr) throw qErr;

  const cRows = [];
  inserted.forEach((q, i) => {
    rows[i].choices.forEach((c, j) => {
      cRows.push({
        question_id: q.id,
        text: c.text,
        is_correct: !!c.is_correct,
        position: j,
      });
    });
  });

  const { error: cErr } = await supabase.from('choices').insert(cRows);
  if (cErr) {
    await supabase.from('questions').delete().in('id', inserted.map(q => q.id));
    throw cErr;
  }
  return inserted.length;
}

/* ---------- bulk text parser ---------- */
export function parseBulkText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('No data to parse.');

  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  const rawRows = lines.map(l => splitLine(l, delimiter));

  let start = 0;
  const first = rawRows[0].map(c => c.toLowerCase());
  if (first[0].includes('question') || first.some(c => c === 'correct' || c === 'answer')) {
    start = 1;
  }

  const parsed = [];
  const errors = [];

  for (let i = start; i < rawRows.length; i++) {
    const cells = rawRows[i].map(c => c.trim());
    const lineNo = i + 1;

    if (cells.length < 3) {
      errors.push(`Line ${lineNo}: needs a question, at least 2 choices, and a correct answer.`);
      continue;
    }

    const qText = cells[0];
    const correctRaw = cells[cells.length - 1];
    const choiceTexts = cells.slice(1, cells.length - 1).filter(c => c !== '');

    if (!qText) { errors.push(`Line ${lineNo}: question text is empty.`); continue; }
    if (choiceTexts.length < 2 || choiceTexts.length > 6) {
      errors.push(`Line ${lineNo}: must have 2–6 choices, found ${choiceTexts.length}.`);
      continue;
    }

    const idx = resolveCorrectIndex(correctRaw, choiceTexts);
    if (idx < 0) {
      errors.push(`Line ${lineNo}: correct answer "${correctRaw}" doesn't match any choice.`);
      continue;
    }

    parsed.push({
      text: qText,
      choices: choiceTexts.map((t, j) => ({ text: t, is_correct: j === idx })),
    });
  }

  return { parsed, errors };
}

function splitLine(line, delimiter) {
  if (delimiter === '\t') return line.split('\t');
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function resolveCorrectIndex(raw, choiceTexts) {
  const s = String(raw || '').trim();
  if (!s) return -1;

  const upper = s.toUpperCase();
  if (/^[A-F]$/.test(upper)) {
    const idx = upper.charCodeAt(0) - 65;
    if (idx >= 0 && idx < choiceTexts.length) return idx;
  }
  if (/^[1-6]$/.test(s)) {
    const idx = parseInt(s, 10) - 1;
    if (idx >= 0 && idx < choiceTexts.length) return idx;
  }
  const exact = choiceTexts.findIndex(t => t.trim().toLowerCase() === s.toLowerCase());
  if (exact >= 0) return exact;

  return -1;
}
/* ============================================================
   QUESTIONS + CHOICES + PASSAGES + TOPICS + BULK IMPORT
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
    .select(`
      id, text, passage_id, topic_id, created_at, served_count,
      choices(id, text, is_correct, position),
      passages(id, title, text),
      topics(id, name)
    `)
    .eq('period_id', periodId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listPassages(periodId) {
  const { data, error } = await supabase
    .from('passages')
    .select('id, title, text, created_at')
    .eq('period_id', periodId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listTopics(periodId) {
  const { data, error } = await supabase
    .from('topics')
    .select('id, name, created_at')
    .eq('period_id', periodId)
    .order('name');
  if (error) throw error;
  return data || [];
}

/* ---------- question writes ---------- */
export async function createQuestion(periodId, text, choices, passageId = null, topicId = null) {
  const { data: q, error: qErr } = await supabase
    .from('questions')
    .insert({
      period_id: periodId,
      text,
      passage_id: passageId || null,
      topic_id: topicId || null,
    })
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

export async function updateQuestion(questionId, text, choices, passageId = null, topicId = null) {
  const { error: qErr } = await supabase
    .from('questions')
    .update({
      text,
      passage_id: passageId || null,
      topic_id: topicId || null,
    })
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

/* ---------- passage writes ---------- */
export async function createPassage(periodId, title, text) {
  const { data, error } = await supabase
    .from('passages')
    .insert({ period_id: periodId, title: title || null, text })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePassage(id, title, text) {
  const { error } = await supabase
    .from('passages')
    .update({ title: title || null, text })
    .eq('id', id);
  if (error) throw error;
}

export async function deletePassage(id) {
  const { error } = await supabase.from('passages').delete().eq('id', id);
  if (error) throw error;
}

export async function deletePeriodPassages(periodId) {
  const { error } = await supabase.from('passages').delete().eq('period_id', periodId);
  if (error) throw error;
}

/* ---------- topic writes ---------- */
export async function createTopic(periodId, name) {
  const { data, error } = await supabase
    .from('topics')
    .insert({ period_id: periodId, name: name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTopic(id, name) {
  const { error } = await supabase
    .from('topics')
    .update({ name: name.trim() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTopic(id) {
  const { error } = await supabase.from('topics').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- bulk insert (with auto-topic creation) ---------- */
export async function bulkInsert(periodId, rows) {
  if (!rows.length) return 0;

  /* 1. collect unique topic names from the rows */
  const uniqueNames = new Set();
  rows.forEach(r => {
    const name = (r.topic || '').trim();
    if (name) uniqueNames.add(name);
  });

  /* 2. look up existing topics for this period */
  const { data: existing, error: fetchErr } = await supabase
    .from('topics')
    .select('id, name')
    .eq('period_id', periodId);
  if (fetchErr) throw fetchErr;

  const topicMap = {}; // lowercase name -> id
  (existing || []).forEach(t => {
    topicMap[t.name.toLowerCase()] = t.id;
  });

  /* 3. create any missing topics */
  for (const name of uniqueNames) {
    const key = name.toLowerCase();
    if (!topicMap[key]) {
      const { data, error } = await supabase
        .from('topics')
        .insert({ period_id: periodId, name })
        .select()
        .single();
      if (error) throw error;
      topicMap[key] = data.id;
    }
  }

  /* 4. insert questions with topic_id */
  const qRows = rows.map(r => {
    const name = (r.topic || '').trim();
    return {
      period_id: periodId,
      text: r.text,
      topic_id: name ? topicMap[name.toLowerCase()] : null,
    };
  });

  const { data: inserted, error: qErr } = await supabase
    .from('questions')
    .insert(qRows)
    .select('id');
  if (qErr) throw qErr;

  /* 5. insert choices */
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

/* ---------- bulk text parser (with topic column) ---------- */
export function parseBulkText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('No data to parse.');

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const rawRows = lines.map(l => splitLine(l, delimiter));

  /* ---- detect header + optional topic column ---- */
  let start = 0;
  let topicIdx = -1;

  const firstRow = rawRows[0].map(c => c.toLowerCase().trim());
  const isHeader = firstRow[0].includes('question') ||
                   firstRow.some(c => c === 'correct' || c === 'answer' || c === 'topic');

  if (isHeader) {
    start = 1;
    topicIdx = firstRow.findIndex(c => c === 'topic');
  }

  const parsed = [];
  const errors = [];

  for (let i = start; i < rawRows.length; i++) {
    let cells = rawRows[i].map(c => c.trim());
    const lineNo = i + 1;

    /* ---- extract topic if we detected the column ---- */
    let topicName = null;
    if (topicIdx >= 0) {
      topicName = cells[topicIdx] || null;
      cells = cells.filter((_, idx) => idx !== topicIdx);
    }

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
      topic: topicName ? topicName.trim() : null,
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
/* ============================================================
   QUIZZES — create, list, toggle, delete
   ============================================================ */

import { supabase } from '../supabase.js';

/* ---------- helpers ---------- */
export function generateCode(prefix = '') {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix ? `${prefix}-${s}` : s;
}

/* ---------- reads ---------- */
export async function listSubjectsForQuiz() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, periods(id, name)')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function countQuestionsInPeriod(periodId) {
  const { count, error } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('period_id', periodId);
  if (error) throw error;
  return count || 0;
}

/** Question pool broken down by topic for a given period. */
export async function getPoolBreakdown(periodId) {
  // Fetch topics + counts
  const { data: topics, error: tErr } = await supabase
    .from('topics')
    .select('id, name')
    .eq('period_id', periodId)
    .order('name');
  if (tErr) throw tErr;

  // Fetch all questions with their topic_id
  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, topic_id')
    .eq('period_id', periodId);
  if (qErr) throw qErr;

  const counts = {};
  let untagged = 0;
  (questions || []).forEach(q => {
    if (q.topic_id) counts[q.topic_id] = (counts[q.topic_id] || 0) + 1;
    else untagged++;
  });

  return {
    topics: (topics || []).map(t => ({
      id: t.id,
      name: t.name,
      count: counts[t.id] || 0,
    })),
    untagged,
    total: questions?.length || 0,
  };
}

export async function listQuizzes() {
  const { data, error } = await supabase
    .from('quizzes')
    .select(`
      id, title, code, num_questions, is_active, created_at, opens_at, expires_at,
      shuffle_questions, shuffle_choices, show_score_at_end, use_topics, untagged_num,
      subject_id, period_id,
      subjects(name),
      periods(name)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listQuizTopics(quizId) {
  const { data, error } = await supabase
    .from('quiz_topics')
    .select(`
      topic_id, num_questions,
      topics ( id, name )
    `)
    .eq('quiz_id', quizId);
  if (error) throw error;
  return data || [];
}

export async function getAttemptStats(quizId) {
  const { data, error } = await supabase
    .from('attempts')
    .select('id, submitted, is_flagged')
    .eq('quiz_id', quizId);
  if (error) throw error;
  const total = data.length;
  const submitted = data.filter(a => a.submitted).length;
  const flagged = data.filter(a => a.is_flagged).length;
  return { total, submitted, flagged };
}

/* ---------- writes ---------- */
export async function createQuiz(input) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  /* ---- validate pool size ---- */
  if (input.use_topics) {
    /* per-topic check */
    const breakdown = await getPoolBreakdown(input.period_id);
    const topicCounts = {};
    breakdown.topics.forEach(t => { topicCounts[t.id] = t.count; });

    let totalRequested = input.untagged_num || 0;
    for (const t of input.topics || []) {
      const available = topicCounts[t.topic_id] || 0;
      if (t.num_questions > available) {
        throw new Error(
          `Topic "${t.name}" only has ${available} question${available === 1 ? '' : 's'}, ` +
          `but you asked for ${t.num_questions}.`
        );
      }
      totalRequested += t.num_questions;
    }
    if ((input.untagged_num || 0) > breakdown.untagged) {
      throw new Error(
        `There are only ${breakdown.untagged} untagged question${breakdown.untagged === 1 ? '' : 's'}, ` +
        `but you asked for ${input.untagged_num}.`
      );
    }
    if (totalRequested < 1) {
      throw new Error('Set at least 1 question to draw.');
    }
    input.num_questions = totalRequested;
  } else {
    const available = await countQuestionsInPeriod(input.period_id);
    if (available < input.num_questions) {
      throw new Error(
        `Only ${available} question${available === 1 ? '' : 's'} in the pool, ` +
        `but you asked for ${input.num_questions}. Add more questions or lower the count.`
      );
    }
  }

  /* ---- insert the quiz ---- */
  const { data, error } = await supabase
    .from('quizzes')
    .insert({
      teacher_id: user.id,
      subject_id: input.subject_id,
      period_id: input.period_id,
      title: input.title.trim(),
      code: input.code.trim().toLowerCase(),
      num_questions: input.num_questions,
      shuffle_questions: input.shuffle_questions,
      shuffle_choices: input.shuffle_choices,
      show_score_at_end: input.show_score_at_end,
      opens_at: input.opens_at || null,
      expires_at: input.expires_at || null,
      use_topics: !!input.use_topics,
      untagged_num: input.use_topics ? (input.untagged_num || 0) : 0,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('That code is already in use. Pick another.');
    throw error;
  }

  /* ---- insert topic weights ---- */
  if (input.use_topics && input.topics?.length) {
    const topicRows = input.topics
      .filter(t => t.num_questions > 0)
      .map(t => ({
        quiz_id: data.id,
        topic_id: t.topic_id,
        num_questions: t.num_questions,
      }));
    if (topicRows.length) {
      const { error: tErr } = await supabase.from('quiz_topics').insert(topicRows);
      if (tErr) {
        await supabase.from('quizzes').delete().eq('id', data.id);
        throw tErr;
      }
    }
  }

  return data;
}

export async function toggleQuizActive(quizId, isActive) {
  const { error } = await supabase
    .from('quizzes')
    .update({ is_active: isActive })
    .eq('id', quizId);
  if (error) throw error;
}

export async function deleteQuiz(quizId) {
  const { error } = await supabase.from('quizzes').delete().eq('id', quizId);
  if (error) throw error;
}
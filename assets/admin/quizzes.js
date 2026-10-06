/* ============================================================
   QUIZZES — create, list, toggle, delete
   ============================================================ */

import { supabase } from '../supabase.js';

/* ---------- helpers ---------- */
export function generateCode(prefix = '') {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // no confusing chars
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

export async function listQuizzes() {
  const { data, error } = await supabase
    .from('quizzes')
    .select(`
      id, title, code, num_questions, is_active, created_at, expires_at,
      shuffle_questions, shuffle_choices, show_score_at_end,
      subject_id, period_id,
      subjects(name),
      periods(name)
    `)
    .order('created_at', { ascending: false });
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

  // verify pool size
  const available = await countQuestionsInPeriod(input.period_id);
  if (available < input.num_questions) {
    throw new Error(
      `Only ${available} question${available === 1 ? '' : 's'} in the pool, ` +
      `but you asked for ${input.num_questions}. Add more questions or lower the count.`
    );
  }

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
      expires_at: input.expires_at || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('That code is already in use. Pick another.');
    throw error;
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
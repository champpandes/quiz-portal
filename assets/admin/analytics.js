/* ============================================================
   ANALYTICS — per-question item analysis
   ============================================================ */

import { supabase } from '../supabase.js';

/**
 * Fetch per-question stats for a quiz.
 * Aggregates all submitted attempts, groups by question,
 * counts how many students saw it, how many got it right,
 * average seconds spent, and the distribution of chosen answers.
 */
export async function getQuestionAnalytics(quizId) {
  // 1. Get all submitted attempts for this quiz
  const { data: attempts, error: aErr } = await supabase
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('submitted', true);
  if (aErr) throw aErr;

  if (!attempts || !attempts.length) {
    return {
      questions: [],
      summary: { attempts: 0, questionsSeen: 0, avgScorePercent: 0 },
    };
  }

  const attemptIds = attempts.map(a => a.id);

  // 2. Get all answers for those attempts, with question + choices
  const { data: answers, error: ansErr } = await supabase
    .from('attempt_answers')
    .select(`
      question_id,
      choice_id,
      is_correct,
      seconds_spent,
      questions(id, text, choices(id, text, is_correct, position))
    `)
    .in('attempt_id', attemptIds);
  if (ansErr) throw ansErr;

  const questions = aggregate(answers || []);

  // overall average score across attempts (only submitted with real scores)
  const { data: scoreRows, error: sErr } = await supabase
    .from('attempts')
    .select('percent')
    .eq('quiz_id', quizId)
    .eq('submitted', true)
    .not('percent', 'is', null);
  if (sErr) throw sErr;
  const avgScorePercent = scoreRows.length
    ? Math.round(scoreRows.reduce((s, r) => s + Number(r.percent || 0), 0) / scoreRows.length)
    : 0;

  return {
    questions,
    summary: {
      attempts: attempts.length,
      questionsSeen: questions.length,
      avgScorePercent,
    },
  };
}

function aggregate(answers) {
  const map = new Map();

  for (const a of answers) {
    const qid = a.question_id;
    if (!map.has(qid)) {
      const q = a.questions;
      const choices = (q.choices || []).slice().sort((x, y) => x.position - y.position);
      map.set(qid, {
        question_id: qid,
        text: q.text,
        choices,
        total: 0,
        correct: 0,
        totalSeconds: 0,
        choiceCounts: {},
      });
    }
    const item = map.get(qid);
    item.total++;
    if (a.is_correct) item.correct++;
    item.totalSeconds += a.seconds_spent || 0;
    if (a.choice_id) {
      item.choiceCounts[a.choice_id] = (item.choiceCounts[a.choice_id] || 0) + 1;
    }
  }

  return [...map.values()]
    .map(q => {
      const pct = q.total ? Math.round((q.correct / q.total) * 100) : 0;
      const avgSeconds = q.total ? Math.round(q.totalSeconds / q.total) : 0;
      return { ...q, pct, avgSeconds };
    })
    // hardest first
    .sort((a, b) => a.pct - b.pct);
}
/* ============================================================
   ANALYTICS — per-question item analysis + export
   ============================================================ */

import { supabase } from '../supabase.js';

/**
 * Fetch per-question stats for a quiz.
 * Also returns per-student answer matrix for computing discrimination index.
 */
export async function getQuestionAnalytics(quizId) {
  // 1. All submitted attempts (with scores, for discrimination)
  const { data: attempts, error: aErr } = await supabase
    .from('attempts')
    .select('id, student_number, student_name, score, total_questions, percent')
    .eq('quiz_id', quizId)
    .eq('submitted', true);
  if (aErr) throw aErr;

  if (!attempts || !attempts.length) {
    return {
      questions: [],
      summary: { attempts: 0, questionsSeen: 0, avgScorePercent: 0 },
      attempts: [],
    };
  }

  const attemptIds = attempts.map(a => a.id);

  // 2. All answers for those attempts
  const { data: answers, error: ansErr } = await supabase
    .from('attempt_answers')
    .select(`
      attempt_id,
      question_id,
      choice_id,
      is_correct,
      seconds_spent,
      questions(id, text, choices(id, text, is_correct, position))
    `)
    .in('attempt_id', attemptIds);
  if (ansErr) throw ansErr;

  // 3. Aggregate
  const questions = aggregate(answers || [], attempts);

  // class average
  const avgScorePercent = attempts.length
    ? Math.round(attempts.reduce((s, a) => s + Number(a.percent || 0), 0) / attempts.length)
    : 0;

  return {
    questions,
    summary: {
      attempts: attempts.length,
      questionsSeen: questions.length,
      avgScorePercent,
    },
    attempts: attempts.map(a => ({
      id: a.id,
      student_number: a.student_number,
      student_name: a.student_name,
      score: a.score,
      total: a.total_questions,
      percent: a.percent,
    })),
  };
}

function aggregate(answers, attempts) {
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
        perAttempt: {},       // attempt_id -> { correct, choice_id }
      });
    }
    const item = map.get(qid);
    item.total++;
    if (a.is_correct) item.correct++;
    item.totalSeconds += a.seconds_spent || 0;
    if (a.choice_id) {
      item.choiceCounts[a.choice_id] = (item.choiceCounts[a.choice_id] || 0) + 1;
    }
    item.perAttempt[a.attempt_id] = {
      correct: !!a.is_correct,
      choice_id: a.choice_id,
    };
  }

  // ---------- compute discrimination index ----------
  // Sort attempts by score DESC
  const sortedAttempts = attempts.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const groupSize = Math.max(1, Math.round(sortedAttempts.length * 0.27));
  const topGroup = sortedAttempts.slice(0, groupSize).map(a => a.id);
  const bottomGroup = sortedAttempts.slice(-groupSize).map(a => a.id);

  return [...map.values()]
    .map(q => {
      const pct = q.total ? Math.round((q.correct / q.total) * 100) : 0;
      const avgSeconds = q.total ? Math.round(q.totalSeconds / q.total) : 0;

      // discrimination index — needs at least 4 attempts
      let discrimination = null;
      if (sortedAttempts.length >= 4) {
        const topCorrect = topGroup.filter(id =>
          q.perAttempt[id]?.correct
        ).length;
        const bottomCorrect = bottomGroup.filter(id =>
          q.perAttempt[id]?.correct
        ).length;
        discrimination = (topCorrect - bottomCorrect) / groupSize;
      }

      return {
        ...q,
        pct,
        avgSeconds,
        discrimination,
        groupSize,
      };
    })
    .sort((a, b) => a.pct - b.pct);
}

/* ============================================================
   INTERPRETATIONS (for the report)
   ============================================================ */

function difficultyLabel(pct) {
  if (pct >= 80) return 'Easy';
  if (pct >= 50) return 'Moderate';
  return 'Hard';
}

function discriminationLabel(d) {
  if (d == null) return '— (need ≥4 attempts)';
  if (d >= 0.40) return 'Excellent';
  if (d >= 0.30) return 'Good';
  if (d >= 0.20) return 'Fair';
  if (d >= 0.10) return 'Poor';
  return 'Very poor — consider revising';
}

function distractorQuality(choices, choiceCounts, total, correctId) {
  // For each wrong choice, flag if it's picking up too few / too many
  return choices.map((c, i) => {
    const count = choiceCounts[c.id] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    let note = '';
    if (c.is_correct) {
      note = 'correct answer';
    } else if (count === 0) {
      note = 'dead — no one picked it';
    } else if (pct < 5) {
      note = 'weak — picked by <5%';
    } else if (pct > 60) {
      note = 'over-performing — check for confusion';
    } else {
      note = 'OK';
    }
    return { letter: 'ABCDEFGH'[i] || '·', text: c.text, is_correct: c.is_correct, count, pct, note };
  });
}

/* ============================================================
   EXPORT — Item Analysis (multi-sheet Excel)
   ============================================================ */

export function exportItemAnalysis(quiz, analytics, fmtDateFn) {
  if (typeof window.XLSX === 'undefined') {
    alert('Excel library not loaded. Please refresh and try again.');
    return;
  }

  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  /* ---------- Sheet 1: Summary ---------- */
  const summaryRows = [
    ['Quiz', quiz.title],
    ['Code', quiz.code],
    ['Subject', quiz.subjects?.name || '—'],
    ['Period', quiz.periods?.name || '—'],
    ['Questions per student', quiz.num_questions],
    ['Uses topics', quiz.use_topics ? 'Yes' : 'No'],
    [''],
    ['Attempts', analytics.summary.attempts],
    ['Unique questions served', analytics.summary.questionsSeen],
    ['Class average (%)', analytics.summary.avgScorePercent],
    [''],
    ['Generated', fmtDateFn(new Date().toISOString())],
    [''],
    ['Interpretation guide'],
    ['Difficulty', '80%+ = Easy · 50–79% = Moderate · <50% = Hard'],
    ['Discrimination', '0.40+ Excellent · 0.30–0.39 Good · 0.20–0.29 Fair · <0.20 Poor'],
    ['Discrimination index', 'Compares top 27% and bottom 27% of students by score'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  /* ---------- Sheet 2: Item Analysis ---------- */
  const itemRows = analytics.questions.map((q, idx) => {
    const correctChoice = q.choices.find(c => c.is_correct);
    return {
      '#': idx + 1,
      'Question': q.text,
      'Answered': q.total,
      'Correct': q.correct,
      '% Correct': q.pct,
      'Difficulty': difficultyLabel(q.pct),
      'Discrimination': q.discrimination != null ? Number(q.discrimination.toFixed(2)) : '',
      'Discrimination Label': discriminationLabel(q.discrimination),
      'Avg Time (s)': q.avgSeconds,
      'Correct Answer': correctChoice?.text || '',
    };
  });
  const ws2 = XLSX.utils.json_to_sheet(itemRows);
  ws2['!cols'] = [
    { wch: 4 }, { wch: 60 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 26 },
    { wch: 12 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Item Analysis');

  /* ---------- Sheet 3: Distributions ---------- */
  const distRows = [];
  analytics.questions.forEach((q, idx) => {
    const dist = distractorQuality(q.choices, q.choiceCounts, q.total, null);
    dist.forEach(d => {
      distRows.push({
        '#': idx + 1,
        'Question': q.text,
        'Choice': d.letter,
        'Choice Text': d.text,
        'Is Correct': d.is_correct ? 'yes' : '',
        'Picked': d.count,
        'Picked %': d.pct,
        'Note': d.note,
      });
    });
  });
  const ws3 = XLSX.utils.json_to_sheet(distRows);
  ws3['!cols'] = [
    { wch: 4 }, { wch: 50 }, { wch: 8 }, { wch: 30 },
    { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'Distributions');

  /* ---------- download ---------- */
  const safe = (quiz.title || 'quiz').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `item-analysis-${safe}-${date}.xlsx`);
}

/* ============================================================
   EXPORT — Item Analysis (CSV — single flat sheet)
   ============================================================ */

export function exportItemAnalysisCSV(quiz, analytics) {
  const rows = analytics.questions.map((q, idx) => {
    const correctChoice = q.choices.find(c => c.is_correct);
    const row = {
      '#': idx + 1,
      question: q.text,
      answered: q.total,
      correct: q.correct,
      percent_correct: q.pct,
      difficulty: difficultyLabel(q.pct),
      discrimination: q.discrimination != null ? q.discrimination.toFixed(2) : '',
      avg_seconds: q.avgSeconds,
      correct_answer: correctChoice?.text || '',
    };
    q.choices.forEach((c, i) => {
      const letter = 'ABCDEFGH'[i] || '?';
      row[`choice_${letter}_text`] = c.text;
      row[`choice_${letter}_count`] = q.choiceCounts[c.id] || 0;
    });
    return row;
  });

  const headers = Object.keys(rows[0] || {});
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (quiz.title || 'quiz').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `item-analysis-${safe}-${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
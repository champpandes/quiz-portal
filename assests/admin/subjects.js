/* ============================================================
   SUBJECTS + PERIODS
   ============================================================ */

import { supabase } from '../supabase.js';

export async function listSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, created_at, periods(id, name, created_at)')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createSubject(name) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('subjects')
    .insert({ name: name.trim(), teacher_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSubject(id) {
  const { error } = await supabase.from('subjects').delete().eq('id', id);
  if (error) throw error;
}

export async function createPeriod(subjectId, name) {
  const { data, error } = await supabase
    .from('periods')
    .insert({ subject_id: subjectId, name: name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePeriod(id) {
  const { error } = await supabase.from('periods').delete().eq('id', id);
  if (error) throw error;
}
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { monthRange } from './scheduler.ts';

export async function ensureMassInstances(client: SupabaseClient, parishId: string, month: string) {
  const { data: massTimes, error: timeError } = await client
    .from('mass_times')
    .select('id, parish_id, ministry_id, label, day_of_week, specific_date, service_time, ministers_needed, active, notes, ministries(id, name, short_name, role_singular, role_plural)')
    .eq('parish_id', parishId)
    .eq('active', true);

  if (timeError) throw timeError;

  const rows = expandMassTimes(massTimes || [], month);
  if (rows.length) {
    const { error } = await client
      .from('mass_instances')
      .upsert(rows, { onConflict: 'parish_id,ministry_id,service_date,service_time,label', ignoreDuplicates: true });
    if (error) throw error;
  }

  const { start, end } = monthRange(month);
  const { data: instances, error } = await client
    .from('mass_instances')
    .select('id, parish_id, ministry_id, mass_time_id, service_date, service_time, label, ministers_needed, status, notes, ministries(id, name, short_name, role_singular, role_plural)')
    .eq('parish_id', parishId)
    .gte('service_date', start)
    .lte('service_date', end)
    .order('service_date')
    .order('service_time');

  if (error) throw error;
  return instances || [];
}

function expandMassTimes(massTimes: any[], month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const rows = [];

  for (const massTime of massTimes) {
    const time = String(massTime.service_time).slice(0, 5);

    if (massTime.specific_date) {
      if (String(massTime.specific_date).startsWith(month)) {
        rows.push(toInstanceRow(massTime, String(massTime.specific_date), time));
      }
      continue;
    }

    if (massTime.day_of_week === null || massTime.day_of_week === undefined) continue;
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, monthNumber - 1, day);
      if (date.getDay() === massTime.day_of_week) {
        rows.push(toInstanceRow(massTime, toDateKey(date), time));
      }
    }
  }

  return rows;
}

function toInstanceRow(massTime: any, serviceDate: string, serviceTime: string) {
  return {
    parish_id: massTime.parish_id,
    ministry_id: massTime.ministry_id,
    mass_time_id: massTime.id,
    service_date: serviceDate,
    service_time: serviceTime,
    label: massTime.label,
    ministers_needed: massTime.ministers_needed,
    notes: massTime.notes,
  };
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nextMonthKey(from = new Date()): string {
  return toMonthKey(new Date(from.getFullYear(), from.getMonth() + 1, 1));
}

export function toMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function monthDate(month: string): string {
  return `${month}-01`;
}

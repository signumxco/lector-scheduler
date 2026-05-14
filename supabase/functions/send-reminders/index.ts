import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { requireAdmin, requireCronOrAdmin } from '../_shared/auth.ts';
import { sendEmail } from '../_shared/email.ts';
import { optionalEnv } from '../_shared/env.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { buildReminderEmail, buildReminderSubject, buildUsccbReadingUrl, fetchReadingsForDate } from '../_shared/reminder-email.ts';
import { serviceClient } from '../_shared/supabase.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ parishId?: string; daysAhead?: number }>(request);
    const client = serviceClient();
    const isCron = requireCronOrAdmin(request);
    const admin = isCron ? null : await requireAdmin(client, request, body.parishId);
    const parishId = admin?.parishId || body.parishId || optionalEnv('DEFAULT_PARISH_ID');
    if (!parishId) throw new HttpError('Missing parish id.');

    const daysAhead = body.daysAhead ?? 3;
    const target = new Date();
    target.setDate(target.getDate() + daysAhead);
    const targetDate = target.toISOString().slice(0, 10);

    const { data: parish, error: parishError } = await client
      .from('parishes')
      .select('id, name, from_name, reply_to_email, coordinator_email')
      .eq('id', parishId)
      .single();
    if (parishError) throw parishError;

    const { data: assignments, error: assignmentError } = await client
      .from('assignments')
      .select('id, position_label, volunteers(name, email), ministries(key, name), mass_instances(id, service_date, service_time, label, status)')
      .eq('parish_id', parishId)
      .eq('status', 'published')
      .eq('mass_instances.status', 'published')
      .eq('mass_instances.service_date', targetDate);
    if (assignmentError) throw assignmentError;

    const readingsByDate = new Map<string, Awaited<ReturnType<typeof fetchReadingsForDate>>>();
    let sent = 0;
    for (const assignment of assignments || []) {
      const volunteer = Array.isArray(assignment.volunteers) ? assignment.volunteers[0] : assignment.volunteers;
      const mass = Array.isArray(assignment.mass_instances) ? assignment.mass_instances[0] : assignment.mass_instances;
      const ministry = Array.isArray(assignment.ministries) ? assignment.ministries[0] : assignment.ministries;
      if (!volunteer?.email || !mass) continue;

      const readingUrl = buildUsccbReadingUrl(mass.service_date);
      let readingResult = readingsByDate.get(mass.service_date);
      if (!readingResult && isLector(ministry)) {
        try {
          readingResult = await fetchReadingsForDate(client, mass.service_date);
          readingsByDate.set(mass.service_date, readingResult);
        } catch {
          readingResult = { url: readingUrl, readings: [] };
          readingsByDate.set(mass.service_date, readingResult);
        }
      }

      const emailInput = {
        parishName: parish.name,
        volunteerName: volunteer.name,
        ministryKey: ministry?.key || '',
        ministryName: ministry?.name || 'Ministry',
        assignmentPosition: assignment.position_label,
        massLabel: mass.label,
        serviceDate: mass.service_date,
        serviceTime: String(mass.service_time).slice(0, 5),
        readingUrl: readingResult?.url || readingUrl,
        readings: readingResult?.readings || [],
      };

      await sendEmail(client, parish, 'reminder', volunteer.email, buildReminderSubject(emailInput), buildReminderEmail(emailInput), {
        assignmentId: assignment.id,
        massInstanceId: mass.id,
        serviceDate: mass.service_date,
        daysBefore: daysAhead,
        readingUrl: emailInput.readingUrl,
      });
      sent += 1;
    }

    await client.from('audit_log').insert({
      parish_id: parishId,
      actor_admin_user_id: admin?.adminUserId || null,
      action: 'reminders_sent',
      entity_type: 'service_date',
      metadata: { targetDate, daysAhead, sent },
    });

    return json({ sent, targetDate, daysAhead });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

function isLector(ministry: any): boolean {
  return ministry?.key === 'lector' || String(ministry?.name || '').toLowerCase().includes('lector');
}

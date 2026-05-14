import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { assertCanMutate, requireAdmin } from '../_shared/auth.ts';
import { baseEmail, escapeHtml, sendEmail } from '../_shared/email.ts';
import { optionalEnv } from '../_shared/env.ts';
import { handleThrown, json, readJson } from '../_shared/http.ts';
import { monthRange, DbMassInstance } from '../_shared/scheduler.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { randomToken, tokenHash } from '../_shared/tokens.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ month?: string }>(request);
    const client = serviceClient();
    const admin = await requireAdmin(client, request);
    assertCanMutate(admin);

    const month = body.month || new Date().toISOString().slice(0, 7);
    const { start, end } = monthRange(month);
    const appBaseUrl = optionalEnv('APP_BASE_URL', 'http://localhost:5173').replace(/\/$/, '');

    const { data: parish, error: parishError } = await client
      .from('parishes')
      .select('id, name, from_name, reply_to_email, coordinator_email')
      .eq('id', admin.parishId)
      .single();
    if (parishError) throw parishError;

    const { data: masses, error: massError } = await client
      .from('mass_instances')
      .select('id, service_date, service_time, label, ministers_needed, assignments(id, volunteer_id, position_label, volunteers(name, email))')
      .eq('parish_id', admin.parishId)
      .gte('service_date', start)
      .lte('service_date', end)
      .eq('status', 'approved')
      .order('service_date')
      .order('service_time');
    if (massError) throw massError;

    const byVolunteer = new Map<string, { name: string; email: string; rows: string[] }>();
    for (const mass of masses || []) {
      for (const assignment of mass.assignments || []) {
        const volunteer = Array.isArray(assignment.volunteers) ? assignment.volunteers[0] : assignment.volunteers;
        if (!volunteer?.email) continue;
        const token = randomToken();
        await client.from('assignments').update({
          coverage_token_hash: await tokenHash(token),
          status: 'published',
          published_at: new Date().toISOString(),
        }).eq('id', assignment.id);

        const coverageUrl = `${appBaseUrl}/coverage?token=${token}&assignment=${assignment.id}`;
        const existing = byVolunteer.get(assignment.volunteer_id) || { name: volunteer.name, email: volunteer.email, rows: [] };
        existing.rows.push(`
          <li>
            <strong>${formatMass(mass)}</strong><br>
            ${escapeHtml(mass.label)} · ${escapeHtml(assignment.position_label)}
            <div style="margin-top:8px;"><a href="${coverageUrl}">Request coverage</a></div>
          </li>`);
        byVolunteer.set(assignment.volunteer_id, existing);
      }
      await client.from('mass_instances').update({ status: 'published' }).eq('id', mass.id);
    }

    for (const volunteer of byVolunteer.values()) {
      const html = `
        <p>Dear ${escapeHtml(volunteer.name)},</p>
        <p>Thank you for serving. Here are your ministry assignments:</p>
        <ul style="padding-left:20px;">${volunteer.rows.join('')}</ul>
        <p style="color:#6b7280;font-size:14px;">You will receive a reminder before each Mass.</p>`;
      await sendEmail(client, parish, 'assignment_notice', volunteer.email, 'Your Ministry Assignments', baseEmail('Your Assignments', parish.name, html), {
        month,
      });
    }

    await client.from('audit_log').insert({
      parish_id: admin.parishId,
      actor_admin_user_id: admin.adminUserId,
      action: 'schedule_published',
      entity_type: 'month',
      metadata: { month, volunteerCount: byVolunteer.size },
    });

    return json({ published: byVolunteer.size, month });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

function formatMass(mass: DbMassInstance): string {
  const date = new Date(`${mass.service_date}T${String(mass.service_time).slice(0, 5)}`);
  return `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

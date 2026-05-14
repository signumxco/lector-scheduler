import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { requireAdmin, requireCronOrAdmin } from '../_shared/auth.ts';
import { baseEmail, sendEmail } from '../_shared/email.ts';
import { optionalEnv } from '../_shared/env.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { ensureMassInstances, monthDate, nextMonthKey } from '../_shared/masses.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { randomToken, tokenHash } from '../_shared/tokens.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ month?: string; parishId?: string; ministryId?: string }>(request);
    const client = serviceClient();
    const isCron = requireCronOrAdmin(request);
    const admin = isCron ? null : await requireAdmin(client, request, body.parishId);
    const parishId = admin?.parishId || body.parishId || optionalEnv('DEFAULT_PARISH_ID');
    if (!parishId) throw new HttpError('Missing parish id.');

    const month = body.month || nextMonthKey();
    const appBaseUrl = optionalEnv('APP_BASE_URL', 'http://localhost:5173').replace(/\/$/, '');

    const { data: parish, error: parishError } = await client
      .from('parishes')
      .select('id, name, ministry_name, from_name, reply_to_email, coordinator_email')
      .eq('id', parishId)
      .single();
    if (parishError) throw parishError;

    const { data: ministry, error: ministryError } = await client
      .from('ministries')
      .select('id, name, short_name')
      .eq('parish_id', parishId)
      .eq('active', true)
      .match(body.ministryId ? { id: body.ministryId } : {})
      .order('sort_order')
      .limit(1)
      .single();
    if (ministryError) throw ministryError;

    await ensureMassInstances(client, parishId, month);

    const { data: volunteers, error: volunteerError } = await client
      .from('volunteers')
      .select('id, name, email, volunteer_ministries!inner(ministry_id)')
      .eq('parish_id', parishId)
      .eq('volunteer_ministries.ministry_id', ministry.id)
      .eq('active', true)
      .order('name');
    if (volunteerError) throw volunteerError;

    let sent = 0;
    for (const volunteer of volunteers || []) {
      const token = randomToken();
      const hash = await tokenHash(token);
      const { error } = await client.from('availability_requests').upsert(
        {
          parish_id: parishId,
          ministry_id: ministry.id,
          volunteer_id: volunteer.id,
          month: monthDate(month),
          token_hash: hash,
          expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: 'volunteer_id,ministry_id,month' },
      );
      if (error) throw error;

      const url = `${appBaseUrl}/availability?token=${token}&ministry=${ministry.id}`;
      const bodyHtml = `
        <p>Dear ${volunteer.name},</p>
        <p>Please submit your availability for <strong>${month}</strong>.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${url}" style="background:#ff7033;color:white;padding:13px 24px;border-radius:999px;text-decoration:none;display:inline-block;">Submit Availability</a>
        </p>
        <p style="color:#6b7280;font-size:14px;">This link is personal to you. If you submit again, your latest response replaces the old one.</p>`;

      await sendEmail(client, parish, 'availability_request', volunteer.email, `${ministry.name} Availability Request`, baseEmail('Availability Request', parish.name, bodyHtml), {
        volunteerId: volunteer.id,
        ministryId: ministry.id,
        month,
      });
      sent += 1;
    }

    await client.from('audit_log').insert({
      parish_id: parishId,
      actor_admin_user_id: admin?.adminUserId || null,
      action: 'availability_requests_sent',
      entity_type: 'month',
      metadata: { month, count: sent },
    });

    return json({ sent, month });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { ensureMassInstances } from '../_shared/masses.ts';
import { monthRange } from '../_shared/scheduler.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { tokenHash } from '../_shared/tokens.ts';

serve(async (request) => {
  try {
    const body = await readJson<{
      token?: string;
      mode?: 'read';
      selections?: Array<{ massInstanceId: string; available: boolean }>;
    }>(request);
    if (!body.token) throw new HttpError('Missing availability token.');

    const client = serviceClient();
    const hash = await tokenHash(body.token);

    const { data: requestRow, error: requestError } = await client
      .from('availability_requests')
      .select('id, parish_id, ministry_id, volunteer_id, month, expires_at, volunteers(id, name, email), ministries(id, parish_id, key, name, short_name, role_singular, role_plural, accent_color, active, sort_order), parishes(id, name, timezone, from_name, reply_to_email, coordinator_email)')
      .eq('token_hash', hash)
      .single();
    if (requestError || !requestRow) throw new HttpError('This availability link is invalid.', 404);
    if (new Date(requestRow.expires_at).getTime() < Date.now()) throw new HttpError('This availability link has expired.', 410);

    const month = String(requestRow.month).slice(0, 7);
    const instances = (await ensureMassInstances(client, requestRow.parish_id, month)).filter((mass: any) => mass.ministry_id === requestRow.ministry_id);

    if (body.mode === 'read' || !body.selections) {
      const { data: responses, error: responseError } = await client
        .from('availability_responses')
        .select('mass_instance_id, available')
        .eq('availability_request_id', requestRow.id);
      if (responseError) throw responseError;

      const responseMap = new Map((responses || []).map((response: any) => [response.mass_instance_id, response.available]));
      const parish = Array.isArray(requestRow.parishes) ? requestRow.parishes[0] : requestRow.parishes;
      const ministry = Array.isArray(requestRow.ministries) ? requestRow.ministries[0] : requestRow.ministries;
      const volunteer = Array.isArray(requestRow.volunteers) ? requestRow.volunteers[0] : requestRow.volunteers;

      return json({
        parish: {
          id: parish.id,
          name: parish.name,
          timezone: parish.timezone,
          fromName: parish.from_name,
          replyToEmail: parish.reply_to_email,
          coordinatorEmail: parish.coordinator_email,
        },
        ministry: {
          id: ministry.id,
          parishId: ministry.parish_id,
          key: ministry.key,
          name: ministry.name,
          shortName: ministry.short_name,
          roleSingular: ministry.role_singular,
          rolePlural: ministry.role_plural,
          accentColor: ministry.accent_color,
          active: ministry.active,
          sortOrder: ministry.sort_order,
        },
        volunteer: {
          id: volunteer.id,
          name: volunteer.name,
          email: volunteer.email,
        },
        monthLabel: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        masses: instances.map((mass: any) => ({
          massInstanceId: mass.id,
          date: mass.service_date,
          time: String(mass.service_time).slice(0, 5),
          label: mass.label,
          ministryId: mass.ministry_id,
          ministryName: mass.ministries?.name || '',
          rolePlural: mass.ministries?.role_plural || 'Volunteers',
          slotsNeeded: mass.ministers_needed,
          available: responseMap.has(mass.id) ? responseMap.get(mass.id) : null,
        })),
      });
    }

    const allowedMassIds = new Set(instances.map((mass: any) => mass.id));
    const rows = body.selections
      .filter((selection) => allowedMassIds.has(selection.massInstanceId))
      .map((selection) => ({
        parish_id: requestRow.parish_id,
        ministry_id: requestRow.ministry_id,
        volunteer_id: requestRow.volunteer_id,
        availability_request_id: requestRow.id,
        mass_instance_id: selection.massInstanceId,
        available: selection.available,
      }));

    await client.from('availability_responses').delete().eq('availability_request_id', requestRow.id);
    if (rows.length) {
      const { error } = await client.from('availability_responses').insert(rows);
      if (error) throw error;
    }

    const { start, end } = monthRange(month);
    await client.from('availability_requests').update({ submitted_at: new Date().toISOString() }).eq('id', requestRow.id);
    await client.from('audit_log').insert({
      parish_id: requestRow.parish_id,
      action: 'availability_submitted',
      entity_type: 'availability_request',
      entity_id: requestRow.id,
      metadata: { responseCount: rows.length, start, end },
    });

    return json({ message: 'Your availability has been saved. Thank you for your ministry.' });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

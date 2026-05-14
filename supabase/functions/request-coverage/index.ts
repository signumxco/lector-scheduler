import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { baseEmail, escapeHtml, sendEmail } from '../_shared/email.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { tokenHash } from '../_shared/tokens.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ token?: string; assignmentId?: string }>(request);
    if (!body.token || !body.assignmentId) throw new HttpError('Missing coverage request fields.');

    const client = serviceClient();
    const hash = await tokenHash(body.token);

    const { data: assignment, error: assignmentError } = await client
      .from('assignments')
      .select('id, parish_id, position_label, coverage_token_hash, volunteers(name, email), mass_instances(service_date, service_time, label), parishes(id, name, ministry_name, from_name, reply_to_email, coordinator_email)')
      .eq('id', body.assignmentId)
      .eq('coverage_token_hash', hash)
      .single();
    if (assignmentError || !assignment) throw new HttpError('This coverage link is invalid.', 404);

    const parish = Array.isArray(assignment.parishes) ? assignment.parishes[0] : assignment.parishes;
    const volunteer = Array.isArray(assignment.volunteers) ? assignment.volunteers[0] : assignment.volunteers;
    const mass = Array.isArray(assignment.mass_instances) ? assignment.mass_instances[0] : assignment.mass_instances;
    const massLabel = `${formatMass(mass)} · ${mass.label}`;

    await client
      .from('assignments')
      .update({ status: 'coverage_requested', coverage_requested_at: new Date().toISOString() })
      .eq('id', assignment.id);

    const { data: volunteers, error: volunteerError } = await client
      .from('volunteers')
      .select('name, email')
      .eq('parish_id', assignment.parish_id)
      .eq('active', true)
      .neq('email', volunteer.email);
    if (volunteerError) throw volunteerError;

    const html = `
      <p><strong>${escapeHtml(volunteer.name)}</strong> needs coverage for:</p>
      <p><strong>${escapeHtml(massLabel)}</strong><br>${escapeHtml(assignment.position_label)}</p>
      <p>Please reply to the coordinator if you can serve.</p>`;

    await sendEmail(client, parish, 'coverage_request', parish.coordinator_email, `Coverage requested: ${massLabel}`, baseEmail('Coverage Requested', parish.name, html), {
      assignmentId: assignment.id,
    });

    for (const recipient of volunteers || []) {
      await sendEmail(client, parish, 'coverage_request', recipient.email, `Coverage needed: ${massLabel}`, baseEmail('Coverage Needed', parish.name, html), {
        assignmentId: assignment.id,
      });
    }

    await client.from('audit_log').insert({
      parish_id: assignment.parish_id,
      action: 'coverage_requested',
      entity_type: 'assignment',
      entity_id: assignment.id,
      metadata: { requester: volunteer.email, recipientCount: volunteers?.length || 0 },
    });

    return json({ message: 'Coverage has been requested. The coordinator will confirm the replacement.' });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

function formatMass(mass: any): string {
  const date = new Date(`${mass.service_date}T${String(mass.service_time).slice(0, 5)}`);
  return `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

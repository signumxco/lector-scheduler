import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { requireAdmin, requireCronOrAdmin } from '../_shared/auth.ts';
import { optionalEnv } from '../_shared/env.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { ensureMassInstances, monthDate, nextMonthKey } from '../_shared/masses.ts';
import { scheduleMasses } from '../_shared/scheduler.ts';
import { serviceClient } from '../_shared/supabase.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ month?: string; parishId?: string }>(request);
    const client = serviceClient();
    const isCron = requireCronOrAdmin(request);
    const admin = isCron ? null : await requireAdmin(client, request, body.parishId);
    const parishId = admin?.parishId || body.parishId || optionalEnv('DEFAULT_PARISH_ID');
    if (!parishId) throw new HttpError('Missing parish id.');

    const month = body.month || nextMonthKey();
    const masses = await ensureMassInstances(client, parishId, month);
    const mutableMasses = masses.filter((mass: any) => mass.status !== 'approved' && mass.status !== 'published');
    const massIds = mutableMasses.map((mass: any) => mass.id);

    const [volunteersResult, responsesResult] = await Promise.all([
      client.from('volunteers').select('id, name, email, active, volunteer_ministries(ministry_id)').eq('parish_id', parishId),
      client
        .from('availability_responses')
        .select('volunteer_id, mass_instance_id, available')
        .eq('parish_id', parishId)
        .in('mass_instance_id', massIds.length ? massIds : ['00000000-0000-0000-0000-000000000000']),
    ]);
    if (volunteersResult.error) throw volunteersResult.error;
    if (responsesResult.error) throw responsesResult.error;

    const { data: run, error: runError } = await client
      .from('schedule_runs')
      .insert({
        parish_id: parishId,
        month: monthDate(month),
        status: 'reviewing',
        generated_by: admin?.adminUserId || null,
      })
      .select('id')
      .single();
    if (runError) throw runError;

    const volunteers = (volunteersResult.data || []).map((volunteer: any) => ({
      id: volunteer.id,
      name: volunteer.name,
      email: volunteer.email,
      active: volunteer.active,
      ministry_ids: (volunteer.volunteer_ministries || []).map((membership: any) => membership.ministry_id),
    }));
    const scheduled = scheduleMasses(mutableMasses as any[], volunteers, responsesResult.data || []);
    if (massIds.length) {
      await client.from('assignments').delete().eq('parish_id', parishId).in('mass_instance_id', massIds);
    }

    const assignmentRows = scheduled.flatMap((item) =>
      item.assignments.map((assignment) => ({
        ...assignment,
        schedule_run_id: run.id,
      })),
    );
    if (assignmentRows.length) {
      const { error } = await client.from('assignments').insert(assignmentRows);
      if (error) throw error;
    }

    for (const item of scheduled) {
      await client
        .from('mass_instances')
        .update({ status: item.openings > 0 ? 'needs_attention' : 'draft' })
        .eq('id', item.mass.id);
    }

    await client.from('audit_log').insert({
      parish_id: parishId,
      actor_admin_user_id: admin?.adminUserId || null,
      action: 'schedule_generated',
      entity_type: 'schedule_run',
      entity_id: run.id,
      metadata: {
        month,
        massCount: mutableMasses.length,
        protectedMassCount: masses.length - mutableMasses.length,
        assignmentCount: assignmentRows.length,
        needsAttention: scheduled.filter((item) => item.openings > 0).length,
      },
    });

    return json({
      scheduleRunId: run.id,
      month,
      massCount: mutableMasses.length,
      protectedMassCount: masses.length - mutableMasses.length,
      assignmentCount: assignmentRows.length,
      needsAttention: scheduled.filter((item) => item.openings > 0).length,
    });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

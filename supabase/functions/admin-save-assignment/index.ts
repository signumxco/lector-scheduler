import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { assertCanMutate, requireAdmin } from '../_shared/auth.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ massInstanceId?: string; volunteerIds?: string[]; status?: string }>(request);
    if (!body.massInstanceId) throw new HttpError('Mass instance is required.');

    const client = serviceClient();
    const admin = await requireAdmin(client, request);
    assertCanMutate(admin);

    const { data: mass, error: massError } = await client
      .from('mass_instances')
      .select('id, parish_id, ministry_id, service_date, service_time, label, ministers_needed, ministries(role_singular, role_plural, name, short_name)')
      .eq('id', body.massInstanceId)
      .eq('parish_id', admin.parishId)
      .single();
    if (massError) throw massError;

    const volunteerIds = [...new Set(body.volunteerIds || [])];
    if (volunteerIds.length > mass.ministers_needed) {
      throw new HttpError(`This Mass only has ${mass.ministers_needed} slot(s). Remove someone before adding another volunteer.`, 409);
    }

    if (volunteerIds.length) {
      const { data: eligibleRows, error: eligibleError } = await client
        .from('volunteer_ministries')
        .select('volunteer_id')
        .eq('parish_id', admin.parishId)
        .eq('ministry_id', mass.ministry_id)
        .in('volunteer_id', volunteerIds);
      if (eligibleError) throw eligibleError;
      const eligibleIds = new Set((eligibleRows || []).map((row: any) => row.volunteer_id));
      const ineligible = volunteerIds.filter((volunteerId) => !eligibleIds.has(volunteerId));
      if (ineligible.length) throw new HttpError('One or more selected volunteers do not belong to this ministry.', 409);
    }

    await client.from('assignments').delete().eq('mass_instance_id', mass.id).eq('parish_id', admin.parishId);

    if (volunteerIds.length) {
      const rows = volunteerIds.map((volunteerId, index) => ({
        parish_id: admin.parishId,
        ministry_id: mass.ministry_id,
        mass_instance_id: mass.id,
        volunteer_id: volunteerId,
        position_label: `Minister ${index + 1}`,
        status: 'draft',
      }));
      const { error } = await client.from('assignments').insert(rows);
      if (error) throw error;
    }

    const openings = Math.max(0, mass.ministers_needed - volunteerIds.length);
    const nextStatus = body.status || (openings > 0 ? 'needs_attention' : 'draft');
    const { error: updateError } = await client
      .from('mass_instances')
      .update({ status: nextStatus })
      .eq('id', mass.id)
      .eq('parish_id', admin.parishId);
    if (updateError) throw updateError;

    await client.from('audit_log').insert({
      parish_id: admin.parishId,
      actor_admin_user_id: admin.adminUserId,
      action: 'assignment_saved',
      entity_type: 'mass_instance',
      entity_id: mass.id,
      metadata: { volunteerIds, status: nextStatus },
    });

    const { data: assignments, error: assignmentError } = await client
      .from('assignments')
      .select('id, parish_id, ministry_id, mass_instance_id, volunteer_id, position_label, status, volunteers(name, email)')
      .eq('mass_instance_id', mass.id)
      .order('position_label');
    if (assignmentError) throw assignmentError;

    return json({
      id: mass.id,
      parishId: mass.parish_id,
      ministryId: mass.ministry_id,
      date: mass.service_date,
      time: String(mass.service_time).slice(0, 5),
      label: mass.label,
      ministryName: mass.ministries?.name || '',
      ministryShortName: mass.ministries?.short_name || '',
      roleSingular: mass.ministries?.role_singular || 'Volunteer',
      rolePlural: mass.ministries?.role_plural || 'Volunteers',
      slotsNeeded: mass.ministers_needed,
      status: nextStatus,
      assignments: (assignments || []).map((assignment: any) => ({
        id: assignment.id,
        parishId: assignment.parish_id,
        massInstanceId: assignment.mass_instance_id,
        ministryId: assignment.ministry_id,
        volunteerId: assignment.volunteer_id,
        volunteerName: assignment.volunteers?.name || '',
        volunteerEmail: assignment.volunteers?.email || '',
        positionLabel: assignment.position_label,
        status: assignment.status,
      })),
      openings,
    });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

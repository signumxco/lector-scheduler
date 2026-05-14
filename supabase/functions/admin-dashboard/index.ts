import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { handleThrown, json, readJson } from '../_shared/http.ts';
import { ensureMassInstances, nextMonthKey } from '../_shared/masses.ts';
import { serviceClient } from '../_shared/supabase.ts';

serve(async (request) => {
  try {
    const body = await readJson<{ month?: string; parishId?: string }>(request);
    const client = serviceClient();
    const admin = await requireAdmin(client, request, body.parishId);
    const month = body.month || nextMonthKey();

    const { data: parish, error: parishError } = await client
      .from('parishes')
      .select('id, name, timezone, from_name, reply_to_email, coordinator_email')
      .eq('id', admin.parishId)
      .single();
    if (parishError) throw parishError;

    const [ministriesResult, volunteersResult, massTimesResult, emailResult] = await Promise.all([
      client
        .from('ministries')
        .select('id, parish_id, key, name, short_name, role_singular, role_plural, accent_color, active, sort_order')
        .eq('parish_id', admin.parishId)
        .order('sort_order'),
      client
        .from('volunteers')
        .select('id, parish_id, name, email, active, notes, volunteer_ministries(ministry_id)')
        .eq('parish_id', admin.parishId)
        .order('name'),
      client
        .from('mass_times')
        .select('id, parish_id, ministry_id, label, day_of_week, specific_date, service_time, ministers_needed, active, notes, ministries(id, name, short_name, role_singular, role_plural)')
        .eq('parish_id', admin.parishId)
        .order('day_of_week', { nullsFirst: false })
        .order('service_time'),
      client
        .from('email_events')
        .select('id, created_at, type, recipient_email, status, subject, error_message')
        .eq('parish_id', admin.parishId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (ministriesResult.error) throw ministriesResult.error;
    if (volunteersResult.error) throw volunteersResult.error;
    if (massTimesResult.error) throw massTimesResult.error;
    if (emailResult.error) throw emailResult.error;

    const instances = await ensureMassInstances(client, admin.parishId, month);
    const instanceIds = instances.map((mass) => mass.id);
    const { data: assignments, error: assignmentError } = await client
      .from('assignments')
      .select('id, parish_id, ministry_id, mass_instance_id, volunteer_id, position_label, status, volunteers(id, name, email)')
      .in('mass_instance_id', instanceIds.length ? instanceIds : ['00000000-0000-0000-0000-000000000000'])
      .order('position_label');
    if (assignmentError) throw assignmentError;

    const assignmentsByMass = new Map<string, any[]>();
    for (const assignment of assignments || []) {
      const group = assignmentsByMass.get(assignment.mass_instance_id) || [];
      group.push(assignment);
      assignmentsByMass.set(assignment.mass_instance_id, group);
    }

    return json({
      parish: {
        id: parish.id,
        name: parish.name,
        timezone: parish.timezone,
        fromName: parish.from_name,
        replyToEmail: parish.reply_to_email,
        coordinatorEmail: parish.coordinator_email,
      },
      ministries: (ministriesResult.data || []).map((ministry: any) => ({
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
      })),
      activeMonth: month,
      volunteers: (volunteersResult.data || []).map((volunteer: any) => ({
        id: volunteer.id,
        parishId: volunteer.parish_id,
        name: volunteer.name,
        email: volunteer.email,
        active: volunteer.active,
        ministryIds: (volunteer.volunteer_ministries || []).map((membership: any) => membership.ministry_id),
        notes: volunteer.notes || '',
      })),
      massTimes: (massTimesResult.data || []).map((massTime: any) => ({
        id: massTime.id,
        parishId: massTime.parish_id,
        label: massTime.label,
        dayOfWeek: massTime.day_of_week,
        specificDate: massTime.specific_date,
        time: String(massTime.service_time).slice(0, 5),
        ministryId: massTime.ministry_id,
        ministryName: massTime.ministries?.name || '',
        ministryShortName: massTime.ministries?.short_name || '',
        roleSingular: massTime.ministries?.role_singular || 'Volunteer',
        rolePlural: massTime.ministries?.role_plural || 'Volunteers',
        slotsNeeded: massTime.ministers_needed,
        active: massTime.active,
        notes: massTime.notes || '',
      })),
      schedule: instances.map((mass: any) => {
        const massAssignments = assignmentsByMass.get(mass.id) || [];
        return {
          id: mass.id,
          parishId: mass.parish_id,
          massTimeId: mass.mass_time_id,
          date: mass.service_date,
          time: String(mass.service_time).slice(0, 5),
          label: mass.label,
          ministryId: mass.ministry_id,
          ministryName: mass.ministries?.name || '',
          ministryShortName: mass.ministries?.short_name || '',
          roleSingular: mass.ministries?.role_singular || 'Volunteer',
          rolePlural: mass.ministries?.role_plural || 'Volunteers',
          slotsNeeded: mass.ministers_needed,
          status: mass.status,
          notes: mass.notes || '',
          assignments: massAssignments.map((assignment: any) => ({
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
          openings: Math.max(0, mass.ministers_needed - massAssignments.length),
        };
      }),
      emailEvents: (emailResult.data || []).map((event: any) => ({
        id: event.id,
        createdAt: event.created_at,
        type: event.type,
        recipientEmail: event.recipient_email,
        status: event.status,
        subject: event.subject,
        errorMessage: event.error_message || '',
      })),
    });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

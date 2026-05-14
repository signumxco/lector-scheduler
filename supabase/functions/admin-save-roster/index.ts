import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { assertCanMutate, requireAdmin } from '../_shared/auth.ts';
import { handleThrown, HttpError, json, readJson } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (request) => {
  try {
    const body = await readJson<{ volunteer?: { id?: string; name: string; email: string; active?: boolean; ministryIds?: string[]; notes?: string } }>(request);
    if (!body.volunteer?.name || !body.volunteer?.email) throw new HttpError('Volunteer name and email are required.');

    const client = serviceClient();
    const admin = await requireAdmin(client, request);
    assertCanMutate(admin);

    const payload: Record<string, unknown> = {
      parish_id: admin.parishId,
      name: body.volunteer.name.trim(),
      email: body.volunteer.email.trim().toLowerCase(),
      active: body.volunteer.active ?? true,
      notes: body.volunteer.notes || null,
    };
    if (body.volunteer.id && uuidPattern.test(body.volunteer.id)) payload.id = body.volunteer.id;

    const { data, error } = await client
      .from('volunteers')
      .upsert(payload, { onConflict: 'id' })
      .select('id, parish_id, name, email, active, notes')
      .single();
    if (error) throw error;

    if (body.volunteer.ministryIds?.length) {
      await client.from('volunteer_ministries').delete().eq('parish_id', admin.parishId).eq('volunteer_id', data.id);
      const { error: membershipError } = await client.from('volunteer_ministries').insert(
        body.volunteer.ministryIds.map((ministryId) => ({
          parish_id: admin.parishId,
          volunteer_id: data.id,
          ministry_id: ministryId,
        })),
      );
      if (membershipError) throw membershipError;
    }

    await client.from('audit_log').insert({
      parish_id: admin.parishId,
      actor_admin_user_id: admin.adminUserId,
      action: 'volunteer_saved',
      entity_type: 'volunteer',
      entity_id: data.id,
      metadata: { email: data.email },
    });

    return json({
      id: data.id,
      parishId: data.parish_id,
      name: data.name,
      email: data.email,
      active: data.active,
      ministryIds: body.volunteer.ministryIds || [],
      notes: data.notes || '',
    });
  } catch (thrown) {
    return handleThrown(thrown);
  }
});

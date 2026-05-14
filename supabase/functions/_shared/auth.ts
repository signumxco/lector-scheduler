import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { optionalEnv } from './env.ts';
import { HttpError } from './http.ts';

export interface AdminContext {
  adminUserId: string;
  authUserId: string;
  email: string;
  parishId: string;
  role: 'owner' | 'coordinator' | 'assistant';
}

export async function requireAdmin(client: SupabaseClient, request: Request, parishId?: string): Promise<AdminContext> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError('Missing admin authorization.', 401);

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError('Invalid admin session.', 401);

  const { data: adminUser, error: adminError } = await client
    .from('admin_users')
    .select('id, email, auth_user_id')
    .eq('auth_user_id', userData.user.id)
    .single();

  if (adminError || !adminUser) throw new HttpError('This email is not configured as a scheduler admin.', 403);

  let roleQuery = client
    .from('admin_roles')
    .select('parish_id, role')
    .eq('admin_user_id', adminUser.id)
    .eq('active', true)
    .limit(1);

  const defaultParishId = parishId || optionalEnv('DEFAULT_PARISH_ID');
  if (defaultParishId) roleQuery = roleQuery.eq('parish_id', defaultParishId);

  const { data: roles, error: roleError } = await roleQuery;
  if (roleError || !roles?.length) throw new HttpError('No active parish role found for this admin.', 403);

  const role = roles[0];
  return {
    adminUserId: adminUser.id,
    authUserId: userData.user.id,
    email: adminUser.email,
    parishId: role.parish_id,
    role: role.role,
  };
}

export function assertCanMutate(admin: AdminContext) {
  if (admin.role === 'assistant') throw new HttpError('Assistant access is view-only for this action.', 403);
}

export function requireCronOrAdmin(request: Request): boolean {
  const configured = optionalEnv('CRON_SECRET');
  return Boolean(configured && request.headers.get('x-cron-secret') === configured);
}

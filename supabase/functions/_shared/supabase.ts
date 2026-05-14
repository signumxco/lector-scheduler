import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { requiredEnv } from './env.ts';

export function serviceClient() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

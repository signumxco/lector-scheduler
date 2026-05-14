export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readJson<T>(request: Request): Promise<T> {
  if (request.method === 'OPTIONS') throw new OptionsResponse();
  if (request.method !== 'POST') throw new HttpError('Method not allowed', 405);
  return (await request.json().catch(() => ({}))) as T;
}

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export class OptionsResponse extends Error {}

export function handleThrown(thrown: unknown): Response {
  if (thrown instanceof OptionsResponse) return new Response('ok', { headers: corsHeaders });
  if (thrown instanceof HttpError) return error(thrown.message, thrown.status);
  const message = thrown instanceof Error ? thrown.message : 'Unexpected error';
  return error(message, 500);
}

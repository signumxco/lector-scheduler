import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { optionalEnv } from './env.ts';

export interface ParishEmailSettings {
  id: string;
  from_name: string;
  reply_to_email: string;
  coordinator_email: string;
}

export async function sendEmail(
  client: SupabaseClient,
  parish: ParishEmailSettings,
  type: string,
  to: string,
  subject: string,
  html: string,
  metadata: Record<string, unknown> = {},
) {
  const { data: event } = await client
    .from('email_events')
    .insert({
      parish_id: parish.id,
      type,
      recipient_email: to,
      subject,
      status: 'queued',
      metadata,
    })
    .select('id')
    .single();

  const resendKey = optionalEnv('RESEND_API_KEY');
  if (!resendKey) {
    await markEmail(client, event?.id, 'failed', '', 'RESEND_API_KEY is not configured.');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `${parish.from_name} <schedule@${domainFromEmail(parish.reply_to_email)}>`,
      reply_to: parish.reply_to_email,
      to,
      subject,
      html,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await markEmail(client, event?.id, 'failed', '', payload.message || 'Resend request failed.');
    return;
  }

  await markEmail(client, event?.id, 'sent', payload.id || '', '');
}

async function markEmail(
  client: SupabaseClient,
  id: string | undefined,
  status: 'sent' | 'failed',
  providerId: string,
  errorMessage: string,
) {
  if (!id) return;
  await client
    .from('email_events')
    .update({ status, provider_id: providerId || null, error_message: errorMessage || null })
    .eq('id', id);
}

function domainFromEmail(email: string): string {
  return email.split('@')[1] || 'example.com';
}

export function baseEmail(title: string, subtitle: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: Georgia, serif; color:#1f2937; max-width:640px; margin:0 auto; line-height:1.6;">
    <div style="background:linear-gradient(95deg,#0543b0 0%,#519afa 88%);color:white;padding:24px 30px;border-radius:8px 8px 0 0;">
      <h1 style="font-size:24px;margin:0;">${escapeHtml(title)}</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.72);">${escapeHtml(subtitle)}</p>
    </div>
    <div style="border:1px solid #ddd9d1;border-top:0;padding:30px;border-radius:0 0 8px 8px;">
      ${body}
    </div>
  </body>
</html>`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

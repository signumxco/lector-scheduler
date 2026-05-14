import type { AdminDashboardData, AvailabilityPayload, ScheduledMass, Volunteer } from './types';
import { makeDemoAvailability, makeDemoDashboard } from './demoData';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const functionsBaseUrl = supabaseUrl ? `${supabaseUrl}/functions/v1` : '';

const SESSION_KEY = 'emhc-scheduler-session';

export interface Session {
  accessToken: string;
  expiresAt?: number;
  email?: string;
}

export const apiConfig = {
  isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  supabaseUrl,
};

export function readSession(): Session | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  if (accessToken) {
    const session: Session = {
      accessToken,
      expiresAt: Number(hash.get('expires_at')) || undefined,
    };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return session;
  }

  try {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored) as Session;
    if (session.expiresAt && session.expiresAt * 1000 < Date.now()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export async function requestAdminMagicLink(email: string): Promise<void> {
  if (!apiConfig.isConfigured) return;
  const redirectTo = `${window.location.origin}/admin`;
  const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      create_user: false,
      data: { requested_from: 'emhc-scheduler-admin' },
      options: { email_redirect_to: redirectTo },
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function getAdminDashboard(session?: Session | null): Promise<AdminDashboardData> {
  if (!apiConfig.isConfigured) return delay(makeDemoDashboard());
  return callFunction<AdminDashboardData>('admin-dashboard', {}, session);
}

export async function saveVolunteer(volunteer: Volunteer, session?: Session | null): Promise<Volunteer> {
  if (!apiConfig.isConfigured) return delay(volunteer);
  return callFunction<Volunteer>('admin-save-roster', { volunteer }, session);
}

export async function saveAssignment(
  massInstanceId: string,
  volunteerIds: string[],
  status: ScheduledMass['status'],
  session?: Session | null,
): Promise<ScheduledMass> {
  if (!apiConfig.isConfigured) {
    throw new Error('Demo assignment updates are handled locally.');
  }
  return callFunction<ScheduledMass>('admin-save-assignment', { massInstanceId, volunteerIds, status }, session);
}

export async function sendAvailabilityRequests(
  input: { month: string; ministryId: string },
  session?: Session | null,
): Promise<{ sent: number; month: string }> {
  if (!apiConfig.isConfigured) return delay({ sent: 0, month: input.month });
  return callFunction('send-availability-requests', input, session);
}

export async function generateSchedule(input: { month: string }, session?: Session | null): Promise<{ assignmentCount: number; needsAttention: number; month: string }> {
  if (!apiConfig.isConfigured) return delay({ assignmentCount: 0, needsAttention: 0, month: input.month });
  return callFunction('generate-schedule', input, session);
}

export async function publishSchedule(input: { month: string }, session?: Session | null): Promise<{ published: number; month: string }> {
  if (!apiConfig.isConfigured) return delay({ published: 0, month: input.month });
  return callFunction('publish-schedule', input, session);
}

export async function sendReminders(session?: Session | null): Promise<{ sent: number; targetDate: string; daysAhead: number }> {
  if (!apiConfig.isConfigured) return delay({ sent: 0, targetDate: '', daysAhead: 3 });
  return callFunction('send-reminders', {}, session);
}

export async function submitAvailability(
  token: string,
  selections: Array<{ massInstanceId: string; available: boolean }>,
): Promise<{ message: string }> {
  if (!apiConfig.isConfigured) return delay({ message: 'Your availability has been saved. Thank you for your ministry.' });
  return callFunction('submit-availability', { token, selections });
}

export async function getAvailability(token: string): Promise<AvailabilityPayload> {
  const ministryId = new URLSearchParams(window.location.search).get('ministry') || undefined;
  if (!apiConfig.isConfigured) return delay(makeDemoAvailability(ministryId));
  return callFunction<AvailabilityPayload>('submit-availability', { token, mode: 'read' });
}

export async function requestCoverage(token: string, assignmentId: string): Promise<{ message: string }> {
  if (!apiConfig.isConfigured) return delay({ message: 'The coordinator and active ministers have been notified.' });
  return callFunction('request-coverage', { token, assignmentId });
}

async function callFunction<T>(name: string, body: unknown, session?: Session | null): Promise<T> {
  const headers: Record<string, string> = {
    apikey: supabaseAnonKey,
    'content-type': 'application/json',
  };
  if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;

  const response = await fetch(`${functionsBaseUrl}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), 250));
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Supabase ministry scheduler contracts', () => {
  const migration = read('supabase/migrations/0001_initial_schema.sql');
  const readingCacheMigration = read('supabase/migrations/0002_reading_cache.sql');

  it('keeps core scheduling tables ministry-scoped', () => {
    for (const table of [
      'ministries',
      'volunteer_ministries',
      'mass_times',
      'mass_instances',
      'availability_requests',
      'availability_responses',
      'assignments',
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }

    expect(migration).toContain('unique (volunteer_id, ministry_id, month)');
    expect(migration).toContain('unique (parish_id, ministry_id, service_date, service_time, label)');
  });

  it('admin assignment save rejects over-capacity and cross-ministry volunteers', () => {
    const source = read('supabase/functions/admin-save-assignment/index.ts');

    expect(source).toContain('volunteerIds.length > mass.ministers_needed');
    expect(source).toContain('This Mass only has');
    expect(source).toContain("from('volunteer_ministries')");
    expect(source).toContain('do not belong to this ministry');
    expect(source).toContain('ministry_id: mass.ministry_id');
  });

  it('availability requests and responses are ministry-scoped', () => {
    const requestSource = read('supabase/functions/send-availability-requests/index.ts');
    const submitSource = read('supabase/functions/submit-availability/index.ts');

    expect(requestSource).toContain('ministry_id: ministry.id');
    expect(requestSource).toContain("onConflict: 'volunteer_id,ministry_id,month'");
    expect(requestSource).toContain('volunteer_ministries!inner(ministry_id)');
    expect(submitSource).toContain('requestRow.ministry_id');
    expect(submitSource).toContain('mass.ministry_id === requestRow.ministry_id');
  });

  it('publish and reminders exclude cancelled Masses through status gates', () => {
    const publishSource = read('supabase/functions/publish-schedule/index.ts');
    const reminderSource = read('supabase/functions/send-reminders/index.ts');

    expect(publishSource).toContain(".eq('status', 'approved')");
    expect(reminderSource).toContain(".eq('status', 'published')");
    expect(reminderSource).toContain(".eq('mass_instances.status', 'published')");
    expect(reminderSource).toContain('daysAhead ?? 3');
    expect(reminderSource).toContain(".eq('mass_instances.service_date', targetDate)");
  });

  it('reminders cache fetched readings and build lector-specific emails', () => {
    const reminderSource = read('supabase/functions/send-reminders/index.ts');
    const emailSource = read('supabase/functions/_shared/reminder-email.ts');

    expect(readingCacheMigration).toContain('create table public.reading_cache');
    expect(emailSource).toContain('parseUsccbReadings');
    expect(emailSource).toContain('Please prepare for the First Reading');
    expect(emailSource).toContain('Please prepare for the Second Reading');
    expect(emailSource).toContain('Other readings for context');
    expect(reminderSource).toContain('fetchReadingsForDate');
    expect(reminderSource).toContain('readingUrl');
  });

  it('schedule generation protects approved and published Masses', () => {
    const generateSource = read('supabase/functions/generate-schedule/index.ts');

    expect(generateSource).toContain("mass.status !== 'approved' && mass.status !== 'published'");
    expect(generateSource).toContain('mutableMasses');
    expect(generateSource).toContain('protectedMassCount');
  });

  it('email events are logged by the shared email sender', () => {
    const emailSource = read('supabase/functions/_shared/email.ts');

    expect(emailSource).toContain("from('email_events')");
    expect(emailSource).toContain("status: 'queued'");
    expect(emailSource).toContain("'sent'");
    expect(emailSource).toContain("'failed'");
  });
});

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

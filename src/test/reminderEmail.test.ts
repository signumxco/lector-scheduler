import { describe, expect, it } from 'vitest';
import { buildReminderEmail, buildUsccbReadingUrl, makeDemoReminderInput } from '../lib/reminderEmail';

describe('reminder email builder', () => {
  it('builds USCCB reading links from service dates', () => {
    expect(buildUsccbReadingUrl('2026-06-14')).toBe('https://bible.usccb.org/bible/readings/061426.cfm');
  });

  it('highlights the first reading for Lector 1', () => {
    const html = buildReminderEmail(makeDemoReminderInput('lector1'));

    expect(html).toContain('serving as Lector 1');
    expect(html).toContain('Please prepare for the First Reading');
    expect(html).toContain('First Reading');
    expect(html).toContain('Second Reading');
    expect(html).toContain('Gospel');
    expect(html).toContain('Other readings for context');
    expect(html).toContain('View on USCCB');
    expect(html).not.toContain('Prepare this reading:');
    expect(html).not.toContain('Your reading');
    expect(html).not.toContain('Also included');
    expect(html).not.toContain('Hello Daniel Kim');
    expect(html.indexOf('<h2 style="margin:0 0 4px;color:#1f1f1f;font-size:22px;line-height:1.25;">First Reading')).toBeLessThan(
      html.indexOf('Second Reading'),
    );
  });

  it('highlights the second reading for Lector 2', () => {
    const html = buildReminderEmail(makeDemoReminderInput('lector2'));

    expect(html).toContain('serving as Lector 2');
    expect(html).toContain('Please prepare for the Second Reading');
    expect(html).not.toContain('Prepare this reading:');
    expect(html.indexOf('<h2 style="margin:0 0 4px;color:#1f1f1f;font-size:22px;line-height:1.25;">Second Reading')).toBeLessThan(
      html.indexOf('First Reading'),
    );
  });

  it('keeps EMHC reminders simple and skips lector readings', () => {
    const html = buildReminderEmail(makeDemoReminderInput('emhc'));

    expect(html).toContain('serving as Minister 1');
    expect(html).toContain('Please arrive a few minutes early');
    expect(html).not.toContain('Sunday readings');
    expect(html).not.toContain('Your reading');
    expect(html).not.toContain('View on USCCB');
  });
});

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

export interface ReadingSection {
  key: 'first' | 'second' | 'gospel';
  title: string;
  citation: string;
  text: string;
}

export interface ReminderEmailInput {
  parishName: string;
  volunteerName: string;
  ministryKey: string;
  ministryName: string;
  assignmentPosition: string;
  massLabel: string;
  serviceDate: string;
  serviceTime: string;
  readingUrl: string;
  readings?: ReadingSection[];
}

export function buildUsccbReadingUrl(serviceDate: string): string {
  const [year, month, day] = serviceDate.split('-');
  return `https://bible.usccb.org/bible/readings/${month}${day}${year.slice(2)}.cfm`;
}

export function buildReminderSubject(input: ReminderEmailInput): string {
  return `Reminder: ${input.assignmentPosition} on ${formatServiceDate(input.serviceDate, input.serviceTime)}`;
}

export function buildReminderEmail(input: ReminderEmailInput): string {
  const isLector = input.ministryKey === 'lector' || input.ministryName.toLowerCase().includes('lector');
  const highlightedReading = getHighlightedReading(input.assignmentPosition);
  const readings = isLector ? input.readings ?? [] : [];
  const roleNote = getRoleNote(input.assignmentPosition, isLector);
  const assignedReading = highlightedReading ? readings.find((reading) => reading.key === highlightedReading) : null;
  const contextReadings = readings.filter((reading) => reading.key !== highlightedReading);
  const serviceLine = formatServiceLine(input.serviceDate, input.serviceTime, input.massLabel);
  const headline = `You&rsquo;re serving as ${escapeHtml(input.assignmentPosition)} this Sunday`;
  const previewText = `${input.assignmentPosition} · ${serviceLine}`;

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f7f9ff;color:#1f1f1f;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>
    <main style="max-width:620px;margin:0 auto;padding:18px 12px 32px;">
      <section style="background:#ffffff;border:1px solid #d6dce8;border-radius:14px;padding:26px;">
        <p style="margin:0 0 10px;color:#0543b0;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(input.parishName)}</p>
        <h1 style="margin:0 0 10px;font-family:Georgia,serif;font-size:30px;line-height:1.16;font-weight:400;color:#1f1f1f;">${headline}</h1>
        <p style="margin:0 0 22px;color:#4b5563;font-size:17px;line-height:1.5;">${escapeHtml(serviceLine)}</p>
        <h2 style="margin:0 0 8px;color:#1f1f1f;font-size:18px;line-height:1.3;">Your assignment</h2>
        <p style="margin:0 0 24px;font-size:17px;line-height:1.6;color:#374151;">${escapeHtml(roleNote)}</p>
        ${
          isLector
            ? `${assignedReading ? assignedReadingBlock(assignedReading) : missingReadingsBlock(input.readingUrl)}
        ${contextReadings.length ? `<h2 style="margin:26px 0 10px;color:#1f1f1f;font-size:18px;line-height:1.3;">Other readings for context</h2>${contextReadings.map(contextReadingBlock).join('')}` : ''}
        <p style="margin:24px 0 0;">
          <a href="${escapeHtml(input.readingUrl)}" style="display:inline-block;background:#0543b0;color:white;text-decoration:none;border-radius:999px;padding:11px 17px;font-size:15px;font-weight:800;">View on USCCB</a>
        </p>`
            : `<p style="margin:0 0 24px;font-size:17px;line-height:1.6;color:#374151;">Please arrive a few minutes early and check in when you get to the sacristy.</p>`
        }
        <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e8edf5;color:#6c7280;font-size:14px;line-height:1.5;">Questions or conflicts? Reply to this email so the coordinator can help.</p>
      </section>
    </main>
  </body>
</html>`;
}

export async function fetchReadingsForDate(client: SupabaseClient, serviceDate: string): Promise<{ url: string; readings: ReadingSection[] }> {
  const url = buildUsccbReadingUrl(serviceDate);
  const cached = await readCachedReadings(client, serviceDate);
  if (cached?.length) return { url, readings: cached };

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch readings from USCCB: ${response.status}`);
  const html = await response.text();
  const readings = parseUsccbReadings(html);
  if (readings.length) await writeCachedReadings(client, serviceDate, url, readings, 'parsed');
  return { url, readings };
}

export function parseUsccbReadings(html: string): ReadingSection[] {
  const sections: ReadingSection[] = [];
  const sectionPattern = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|<\/main>|<\/article>|$)/gi;
  for (const match of html.matchAll(sectionPattern)) {
    const heading = textFromHtml(match[1]);
    const key = readingKey(heading);
    if (!key) continue;
    const lines = textFromHtml(match[2])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^alleluia$/i.test(line));
    if (!lines.length) continue;
    sections.push({
      key,
      title: key === 'first' ? 'First Reading' : key === 'second' ? 'Second Reading' : 'Gospel',
      citation: lines[0],
      text: lines.slice(1).join('\n\n') || lines[0],
    });
  }
  return sections;
}

async function readCachedReadings(client: SupabaseClient, serviceDate: string): Promise<ReadingSection[] | null> {
  const { data, error } = await client.from('reading_cache').select('readings').eq('service_date', serviceDate).maybeSingle();
  if (error || !data?.readings) return null;
  return data.readings as ReadingSection[];
}

async function writeCachedReadings(client: SupabaseClient, serviceDate: string, url: string, readings: ReadingSection[], status: string) {
  try {
    await client.from('reading_cache').upsert(
      {
        service_date: serviceDate,
        url,
        status,
        readings,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'service_date' },
    );
  } catch {
    // Reading cache is helpful but not required for sending reminders.
  }
}

function readingKey(heading: string): ReadingSection['key'] | null {
  const normalized = heading.toLowerCase();
  if (normalized.includes('gospel')) return 'gospel';
  if (normalized.includes('reading 2') || normalized.includes('reading ii') || normalized.includes('second reading')) return 'second';
  if (normalized.includes('reading 1') || normalized.includes('reading i') || normalized.includes('first reading')) return 'first';
  return null;
}

function assignedReadingBlock(reading: ReadingSection): string {
  return `<section style="border:1px solid #ff7033;border-radius:10px;background:#fff8f4;padding:18px;margin:0 0 18px;">
    <h2 style="margin:0 0 4px;color:#1f1f1f;font-size:22px;line-height:1.25;">${escapeHtml(reading.title)}</h2>
    <p style="margin:0 0 14px;color:#0543b0;font-size:15px;font-weight:800;">${escapeHtml(reading.citation)}</p>
    <p style="margin:0;color:#374151;font-size:17px;line-height:1.65;">${formatReadingText(reading.text)}</p>
  </section>`;
}

function contextReadingBlock(reading: ReadingSection): string {
  return `<article style="border-top:1px solid #e8edf5;padding:14px 0;">
    <h3 style="margin:0 0 3px;color:#1f1f1f;font-size:18px;line-height:1.3;">${escapeHtml(reading.title)}</h3>
    <p style="margin:0 0 10px;color:#0543b0;font-size:14px;font-weight:800;">${escapeHtml(reading.citation)}</p>
    <p style="margin:0;color:#4b5563;font-size:16px;line-height:1.6;">${formatReadingText(reading.text)}</p>
  </article>`;
}

function missingReadingsBlock(readingUrl: string): string {
  return `<section style="border:1px solid #d6dce8;border-radius:10px;background:#f7f9ff;padding:16px;margin:0 0 18px;">
    <h2 style="margin:0 0 6px;color:#1f1f1f;font-size:18px;line-height:1.3;">Prepare your reading</h2>
    <p style="margin:0;color:#4b5563;font-size:16px;line-height:1.55;">The readings are available from USCCB: ${escapeHtml(readingUrl)}</p>
  </section>`;
}

function getHighlightedReading(positionLabel: string): ReadingSection['key'] | null {
  if (/lector\s*1/i.test(positionLabel)) return 'first';
  if (/lector\s*2/i.test(positionLabel)) return 'second';
  return null;
}

function getRoleNote(positionLabel: string, isLector: boolean): string {
  if (!isLector) return `You are scheduled as ${positionLabel}. Thank you for serving at Mass.`;
  if (/lector\s*1/i.test(positionLabel)) {
    return 'Please prepare for the First Reading. You may also be asked to lead the Prayers of the Faithful.';
  }
  if (/lector\s*2/i.test(positionLabel)) {
    return 'Please prepare for the Second Reading. You may also be asked to make announcements after Mass.';
  }
  return `You are scheduled as ${positionLabel}. Please review the readings before Mass.`;
}

function formatServiceDate(serviceDate: string, serviceTime: string): string {
  const date = new Date(`${serviceDate}T${String(serviceTime).slice(0, 5)}`);
  return `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatServiceLine(serviceDate: string, serviceTime: string, massLabel: string): string {
  const date = new Date(`${serviceDate}T${String(serviceTime).slice(0, 5)}`);
  return `${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${massLabel}`;
}

function formatReadingText(text: string): string {
  return escapeHtml(text).replaceAll('\n\n', '<br><br>').replaceAll('\n', '<br>');
}

function textFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

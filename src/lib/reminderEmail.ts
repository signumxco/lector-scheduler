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
  const serviceDate = formatServiceDate(input.serviceDate, input.serviceTime);
  return `Reminder: ${input.assignmentPosition} on ${serviceDate}`;
}

export function buildReminderEmail(input: ReminderEmailInput): string {
  const isLector = input.ministryKey === 'lector' || input.ministryName.toLowerCase().includes('lector');
  const highlightedReading = getHighlightedReading(input.assignmentPosition);
  const roleNote = getRoleNote(input.assignmentPosition, isLector);
  const readings = isLector ? input.readings ?? [] : [];
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

export function makeDemoReminderInput(kind: 'lector1' | 'lector2' | 'emhc'): ReminderEmailInput {
  const base = {
    parishName: 'Example Parish',
    serviceDate: '2026-06-14',
    serviceTime: '08:30',
    massLabel: 'Sunday Mass',
    readingUrl: buildUsccbReadingUrl('2026-06-14'),
  };

  if (kind === 'emhc') {
    return {
      ...base,
      volunteerName: 'Maria Santos',
      ministryKey: 'emhc',
      ministryName: 'Eucharistic Ministers',
      assignmentPosition: 'Minister 1',
      readings: [],
    };
  }

  return {
    ...base,
    volunteerName: kind === 'lector1' ? 'Daniel Kim' : 'Grace Murphy',
    ministryKey: 'lector',
    ministryName: 'Lectors',
    assignmentPosition: kind === 'lector1' ? 'Lector 1' : 'Lector 2',
    readings: demoReadings,
  };
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
  const date = new Date(`${serviceDate}T${serviceTime}`);
  return `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatServiceLine(serviceDate: string, serviceTime: string, massLabel: string): string {
  const date = new Date(`${serviceDate}T${serviceTime}`);
  return `${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${massLabel}`;
}

function formatReadingText(text: string): string {
  return escapeHtml(text).replaceAll('\n\n', '<br><br>').replaceAll('\n', '<br>');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const demoReadings: ReadingSection[] = [
  {
    key: 'first',
    title: 'First Reading',
    citation: 'Example 1:1-6',
    text: 'A reading prepared for preview purposes.\n\nThe people gathered in hope, listened with care, and gave thanks for the grace set before them.',
  },
  {
    key: 'second',
    title: 'Second Reading',
    citation: 'Example 2:1-5',
    text: 'Brothers and sisters, encourage one another in service.\n\nLet every gift be offered with patience, humility, and joy.',
  },
  {
    key: 'gospel',
    title: 'Gospel',
    citation: 'Example 3:1-8',
    text: 'The Lord said to his disciples, "Peace be with you."\n\nAnd they went out to serve with courage and gladness.',
  },
];

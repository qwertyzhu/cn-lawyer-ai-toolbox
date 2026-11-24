export interface CalendarEventInput {
  title: string;
  dueDate: string; // YYYY-MM-DD
  description: string;
  alarmDaysBefore?: number[];
}

function normalizeYmd(ymd: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function formatIcsDateValue(ymd: string): string {
  return normalizeYmd(ymd).replace(/-/g, '');
}

function nextDayYmd(ymd: string): string {
  const [y, m, d] = normalizeYmd(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Valid RFC 5545 duration trigger for 09:00 AM, N days before an all-day DTSTART (00:00).
 * Example: 1 day before at 09:00 => 15h before midnight => "-PT15H"
 *          7 days before at 09:00 => 6d 15h before midnight => "-P6DT15H"
 */
function buildBeforeAlarmTrigger(daysBefore: number): string {
  const n = Math.max(1, Math.floor(daysBefore));
  return n === 1 ? '-PT15H' : `-P${n - 1}DT15H`;
}

function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function buildIcsContent(events: CalendarEventInput[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zhejiang Tianran Law Firm//Tianran AI Toolbox//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:律师办案期限提醒',
  ];

  events.forEach((ev, idx) => {
    const dtStart = formatIcsDateValue(ev.dueDate);
    const dtEnd = nextDayYmd(ev.dueDate);
    const uid = `cnlawyer-${dtStart}-${idx}-${Date.now()}@cn-lawyer-toolbox.local`;
    const alarms = ev.alarmDaysBefore ?? [7, 3, 1];

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dtStart}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeIcsText(`【办案期限】${ev.title}`)}`,
      `DESCRIPTION:${escapeIcsText(ev.description)}`
    );

    for (const days of alarms) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`距离「${ev.title}」届满还有 ${days} 天`)}`,
        // Strict RFC 5545 duration: 09:00 AM N days before all-day date
        `TRIGGER:${buildBeforeAlarmTrigger(days)}`,
        'END:VALARM'
      );
    }
    // Morning of the due date itself (09:00 AM)
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`今日届满：${ev.title}`)}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcsFile(events: CalendarEventInput[], filename = '律师办案期限提醒.ics'): void {
  const ics = buildIcsContent(events);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Minimal iCalendar (RFC 5545) writer for the personal calendar feed. */

export interface CalendarItem {
  id: string;
  title: string;
  start: Date;
  end?: Date | null;
  allDay?: boolean;
  description?: string | null;
  location?: string | null;
  url?: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function icsDate(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const icsDay = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/** Escapes text values: backslash, semicolon, comma and newlines. */
export function icsText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets are folded with CRLF + space. */
export function fold(line: string) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join('\r\n');
}

export function buildIcs(calendarName: string, items: CalendarItem[], now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TEAM OS//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(calendarName)}`];
  for (const item of items) {
    lines.push('BEGIN:VEVENT', `UID:${item.id}@teamos`, `DTSTAMP:${icsDate(now)}`);
    if (item.allDay) {
      const end = new Date((item.end ?? item.start).getTime() + 86_400_000);
      lines.push(`DTSTART;VALUE=DATE:${icsDay(item.start)}`, `DTEND;VALUE=DATE:${icsDay(end)}`);
    } else {
      lines.push(`DTSTART:${icsDate(item.start)}`, `DTEND:${icsDate(item.end ?? new Date(item.start.getTime() + 3_600_000))}`);
    }
    lines.push(`SUMMARY:${icsText(item.title)}`);
    if (item.description) lines.push(`DESCRIPTION:${icsText(item.description)}`);
    if (item.location) lines.push(`LOCATION:${icsText(item.location)}`);
    if (item.url) lines.push(`URL:${item.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

import { buildIcs, fold, icsDate, icsText } from './ics.js';

describe('calendar feed', () => {
  it('formats UTC timestamps', () => {
    expect(icsDate(new Date('2026-09-20T04:05:06Z'))).toBe('20260920T040506Z');
  });

  it('escapes special characters in text', () => {
    expect(icsText('Plan; budget, venue\nday 2')).toBe('Plan\\; budget\\, venue\\nday 2');
  });

  it('folds long lines at 75 characters', () => {
    const folded = fold('X'.repeat(160));
    expect(folded.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('X'.repeat(160));
  });

  it('writes timed and all-day events', () => {
    const ics = buildIcs('Sai', [
      { id: 'm1', title: 'Standup', start: new Date('2026-09-20T04:30:00Z'), end: new Date('2026-09-20T05:00:00Z') },
      { id: 't1', title: 'Due: Poster', start: new Date('2026-09-21T00:00:00Z'), allDay: true },
    ]);
    expect(ics).toContain('DTSTART:20260920T043000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260921');
    expect(ics).toContain('DTEND;VALUE=DATE:20260922');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

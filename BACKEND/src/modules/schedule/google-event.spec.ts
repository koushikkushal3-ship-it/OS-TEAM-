import { localDate, nextDay, readerChanges, toGoogleEvent } from './google-event.js';

const entry = {
  title: 'Annual meet',
  description: 'Bring ID cards',
  location: 'Main hall',
  startsAt: new Date('2026-09-20T04:30:00Z'),
  endsAt: new Date('2026-09-20T06:30:00Z'),
  allDay: false,
  category: 'Event',
};

describe('schedule → Google Calendar', () => {
  it('uses the India date for all-day entries, with an exclusive end date', () => {
    // 20:00 UTC on the 19th is already the 20th in India.
    expect(localDate(new Date('2026-09-19T20:00:00Z'))).toBe('2026-09-20');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    const allDay = toGoogleEvent({ ...entry, allDay: true, endsAt: new Date('2026-09-21T04:30:00Z') }, 'Everyone', 'http://x');
    expect(allDay.start).toEqual({ date: '2026-09-20' });
    expect(allDay.end).toEqual({ date: '2026-09-22' });
  });

  it('sends timed entries with the time zone and a self-explaining description', () => {
    const event = toGoogleEvent(entry, 'Creative Team', 'http://localhost:3000/schedule');
    expect(event.start).toEqual({ dateTime: '2026-09-20T04:30:00.000Z', timeZone: 'Asia/Kolkata' });
    expect(event.description).toContain('For: Creative Team');
    expect(event.description).toContain('Bring ID cards');
    expect(event.location).toBe('Main hall');
  });

  it('shares with exactly the wanted people and never removes the owner', () => {
    const current = [
      { id: 'user:owner@x.in', role: 'owner', scope: { type: 'user', value: 'owner@x.in' } },
      { id: 'user:old@x.in', role: 'reader', scope: { type: 'user', value: 'old@x.in' } },
      { id: 'user:keep@x.in', role: 'reader', scope: { type: 'user', value: 'Keep@x.in' } },
      { id: 'default', role: 'none', scope: { type: 'default' } },
    ];
    const changes = readerChanges(current, ['keep@x.in', 'new@x.in', 'owner@x.in']);
    expect(changes.add).toEqual(['new@x.in']);
    expect(changes.remove).toEqual(['user:old@x.in']);
  });
});

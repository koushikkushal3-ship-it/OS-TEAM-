/** Pure mapping between TEAM OS schedule entries and Google Calendar resources. */

export const SCHEDULE_TIME_ZONE = 'Asia/Kolkata';

export interface ScheduleLike {
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  category: string;
}

/** Calendar date in the organization's time zone, e.g. 2026-09-20. */
export function localDate(d: Date, timeZone = SCHEDULE_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Google's all-day end date is exclusive, so a one-day entry ends on the following day. */
export function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function toGoogleEvent(entry: ScheduleLike, audience: string, portalUrl: string) {
  const description = [entry.description, `Category: ${entry.category}`, `For: ${audience}`, `Managed in TEAM OS: ${portalUrl}`].filter(Boolean).join('\n\n');
  const base = { summary: entry.title, description, location: entry.location ?? undefined };
  if (entry.allDay) {
    return { ...base, start: { date: localDate(entry.startsAt) }, end: { date: nextDay(localDate(entry.endsAt)) } };
  }
  return {
    ...base,
    start: { dateTime: entry.startsAt.toISOString(), timeZone: SCHEDULE_TIME_ZONE },
    end: { dateTime: entry.endsAt.toISOString(), timeZone: SCHEDULE_TIME_ZONE },
  };
}

export interface AclRule {
  id: string;
  role: string;
  scope: { type: string; value?: string };
}

/**
 * Which readers to add and which to remove so the calendar is shared with exactly `wanted`.
 * Only plain user "reader" rules are ever removed — the owner and anything shared by hand stay.
 */
export function readerChanges(current: AclRule[], wanted: string[]) {
  const want = new Set(wanted.map((e) => e.toLowerCase()));
  const readers = current.filter((r) => r.role === 'reader' && r.scope.type === 'user' && r.scope.value);
  const have = new Set(current.filter((r) => r.scope.type === 'user' && r.scope.value).map((r) => r.scope.value!.toLowerCase()));
  return {
    add: [...want].filter((email) => !have.has(email)),
    remove: readers.filter((r) => !want.has(r.scope.value!.toLowerCase())).map((r) => r.id),
  };
}

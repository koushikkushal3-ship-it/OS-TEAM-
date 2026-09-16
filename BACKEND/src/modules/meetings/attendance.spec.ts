import { DEFAULT_ATTENDANCE_POLICY, computeAttendance, mergeSessions, readPolicy } from './attendance.js';

const at = (h: number, m = 0) => new Date(2026, 8, 16, h, m);
const meeting = { scheduledStart: at(19), scheduledEnd: at(20) }; // 7–8 PM, 60 minutes

describe('mergeSessions', () => {
  it('merges overlapping and touching ranges', () => {
    const merged = mergeSessions(
      [
        { joinedAt: at(19, 0), leftAt: at(19, 30) },
        { joinedAt: at(19, 20), leftAt: at(19, 40) },
        { joinedAt: at(19, 50), leftAt: at(20, 0) },
      ],
      at(20),
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].end).toEqual(at(19, 40));
  });

  it('closes an open session at the meeting end', () => {
    const merged = mergeSessions([{ joinedAt: at(19, 10), leftAt: null }], at(20));
    expect(merged[0].end).toEqual(at(20));
  });
});

describe('computeAttendance', () => {
  it('marks a full attendee present (doc example: 7:04 PM – 7:57 PM = 53 minutes)', () => {
    const r = computeAttendance([{ joinedAt: at(19, 4), leftAt: at(19, 57) }], meeting);
    expect(r.minutes).toBe(53);
    expect(r.status).toBe('PRESENT');
  });

  it('marks a late join LATE once past the threshold', () => {
    const r = computeAttendance([{ joinedAt: at(19, 10), leftAt: at(20, 0) }], meeting);
    expect(r.status).toBe('LATE');
    expect(r.percent).toBe(83);
  });

  it('marks short attendance PARTIAL and very short ABSENT', () => {
    expect(computeAttendance([{ joinedAt: at(19, 0), leftAt: at(19, 25) }], meeting).status).toBe('PARTIAL');
    expect(computeAttendance([{ joinedAt: at(19, 0), leftAt: at(19, 10) }], meeting).status).toBe('ABSENT');
  });

  it('no sessions means ABSENT', () => {
    const r = computeAttendance([], meeting);
    expect(r).toMatchObject({ minutes: 0, status: 'ABSENT', firstJoinAt: null });
  });

  it('counts rejoins without double counting overlap', () => {
    const r = computeAttendance(
      [
        { joinedAt: at(19, 0), leftAt: at(19, 20) },
        { joinedAt: at(19, 15), leftAt: at(19, 50) },
      ],
      meeting,
    );
    expect(r.minutes).toBe(50);
    expect(r.status).toBe('PRESENT');
  });

  it('honours organization policy over the defaults', () => {
    const strict = { lateAfterMinutes: 1, partialBelowPercent: 98, absentBelowPercent: 50 };
    expect(computeAttendance([{ joinedAt: at(19, 3), leftAt: at(20, 0) }], meeting, strict).status).toBe('PARTIAL');
    expect(computeAttendance([{ joinedAt: at(19, 3), leftAt: at(20, 0) }], meeting, DEFAULT_ATTENDANCE_POLICY).status).toBe('PRESENT');
  });

  it('uses actual start and end when the meeting ran off schedule', () => {
    const ran = { ...meeting, startedAt: at(19, 30), endedAt: at(20, 30) };
    const r = computeAttendance([{ joinedAt: at(19, 30), leftAt: at(20, 30) }], ran);
    expect(r.minutes).toBe(60);
    expect(r.percent).toBe(100);
    expect(r.status).toBe('PRESENT');
  });
});

describe('readPolicy', () => {
  it('falls back to defaults for missing values', () => {
    expect(readPolicy({ lateAfterMinutes: 10 })).toEqual({ ...DEFAULT_ATTENDANCE_POLICY, lateAfterMinutes: 10 });
    expect(readPolicy(null)).toEqual(DEFAULT_ATTENDANCE_POLICY);
  });
});

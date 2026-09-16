/**
 * Attendance derivation (arch doc §27). Pure functions: participant sessions in,
 * duration and status out. Thresholds are organization policy, configured by
 * Master Admin on the attendance module — never hard-coded judgements.
 */
import type { AttendanceStatus } from '../../generated/prisma/enums.js';

export interface AttendancePolicy {
  /** Joining later than this many minutes after the scheduled start counts as LATE. */
  lateAfterMinutes: number;
  /** Attending less than this share of the meeting counts as PARTIAL. */
  partialBelowPercent: number;
  /** Attending less than this share counts as ABSENT. */
  absentBelowPercent: number;
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  lateAfterMinutes: 5,
  partialBelowPercent: 60,
  absentBelowPercent: 20,
};

export interface SessionInput {
  joinedAt: Date;
  leftAt: Date | null;
}

export interface AttendanceResult {
  minutes: number;
  percent: number;
  firstJoinAt: Date | null;
  lastLeaveAt: Date | null;
  status: AttendanceStatus;
}

/** Overlapping or rejoined sessions are merged so time is never double counted. */
export function mergeSessions(sessions: SessionInput[], fallbackEnd: Date): { start: Date; end: Date }[] {
  const ranges = sessions
    .map((s) => ({ start: s.joinedAt, end: s.leftAt ?? fallbackEnd }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function computeAttendance(
  sessions: SessionInput[],
  meeting: { scheduledStart: Date; scheduledEnd: Date; startedAt?: Date | null; endedAt?: Date | null },
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY,
): AttendanceResult {
  const start = meeting.startedAt ?? meeting.scheduledStart;
  const end = meeting.endedAt ?? meeting.scheduledEnd;
  const merged = mergeSessions(sessions, end);

  if (merged.length === 0) {
    return { minutes: 0, percent: 0, firstJoinAt: null, lastLeaveAt: null, status: 'ABSENT' };
  }

  const ms = merged.reduce((total, r) => total + (r.end.getTime() - r.start.getTime()), 0);
  const minutes = Math.round(ms / 60_000);
  const plannedMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  const percent = Math.min(100, Math.round((minutes / plannedMinutes) * 100));

  const firstJoinAt = merged[0].start;
  const lastLeaveAt = merged[merged.length - 1].end;
  const lateBy = (firstJoinAt.getTime() - start.getTime()) / 60_000;

  const status: AttendanceStatus =
    percent < policy.absentBelowPercent
      ? 'ABSENT'
      : percent < policy.partialBelowPercent
        ? 'PARTIAL'
        : lateBy > policy.lateAfterMinutes
          ? 'LATE'
          : 'PRESENT';

  return { minutes, percent, firstJoinAt, lastLeaveAt, status };
}

export function readPolicy(config: unknown): AttendancePolicy {
  const raw = (config ?? {}) as Partial<AttendancePolicy>;
  return {
    lateAfterMinutes: Number(raw.lateAfterMinutes ?? DEFAULT_ATTENDANCE_POLICY.lateAfterMinutes),
    partialBelowPercent: Number(raw.partialBelowPercent ?? DEFAULT_ATTENDANCE_POLICY.partialBelowPercent),
    absentBelowPercent: Number(raw.absentBelowPercent ?? DEFAULT_ATTENDANCE_POLICY.absentBelowPercent),
  };
}

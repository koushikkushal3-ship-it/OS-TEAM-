"use client";

import { UserCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Select, Spinner, Stat } from "@/components/ui/primitives";
import { useAttendancePolicy, useAttendanceStats } from "@/features/meetings/api";
import { useTeams } from "@/features/teams/api";
import { attendanceLabel, attendanceTone, durationLabel, formatDate } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

export default function AttendancePage() {
  const can = useCan();
  const teams = useTeams();
  const [teamId, setTeamId] = useState("");
  const stats = useAttendanceStats(teamId ? { teamId } : {});
  const policy = useAttendancePolicy();

  const scopeIsTeam = Boolean(teamId);

  return (
    <>
      <PageHeader
        eyebrow="03 · Meetings"
        title="Attendance"
        description="Derived from recorded join and leave times. Participation data, not a performance score."
        actions={
          can("attendance.view") ? (
            <Select className="w-52" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Scope">
              <option value="">My attendance</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      {stats.isLoading || !stats.data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Meetings recorded" value={stats.data.meetings} icon={<UserCheck className="size-4" />} />
            <Stat label="Attendance rate" value={`${stats.data.attendanceRate}%`} hint="Present, late or partial" />
            <Stat label="Time in meetings" value={durationLabel(stats.data.minutes)} />
            <Stat label="Absent" value={stats.data.counts.ABSENT ?? 0} />
          </div>

          <Card>
            <CardHeader title={scopeIsTeam ? "Team attendance" : "My attendance"} description="Most recent ended meetings first." />
            {stats.data.recent.length === 0 ? (
              <EmptyState icon={<UserCheck className="size-6" />} title="Nothing recorded yet" description="Attendance appears once meetings end." />
            ) : (
              <ul className="divide-y divide-line">
                {stats.data.recent.map((r, i) => (
                  <li key={`${r.meeting.id}-${r.user.id}-${i}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-40 flex-1">
                      <Link href={`/meetings/${r.meeting.id}`} className="text-sm font-medium hover:text-brand">
                        {r.meeting.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                        <span>{formatDate(r.meeting.scheduledStart)}</span>
                        {r.meeting.team && <span>{r.meeting.team.name}</span>}
                        {scopeIsTeam && <span>{r.user.name}</span>}
                      </div>
                    </div>
                    <span className="text-xs text-ink-faint">{durationLabel(r.minutes)}</span>
                    <Badge tone={attendanceTone[r.status]}>{attendanceLabel[r.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {policy.data && (
            <p className="mt-3 text-xs text-ink-faint">
              Organization policy: late after {policy.data.lateAfterMinutes} min · partial below {policy.data.partialBelowPercent}% · absent below{" "}
              {policy.data.absentBelowPercent}% of the meeting. Master Admin changes these on the attendance module.
            </p>
          )}
        </>
      )}
    </>
  );
}

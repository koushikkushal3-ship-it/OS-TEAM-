"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarRange, CheckCircle2, ClipboardList, Users, Video } from "lucide-react";
import Link from "next/link";
import { ProgressBar, ProgressBlock } from "@/components/tasks/task-bits";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Spinner, Stat } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import type { DashboardSummary } from "@/lib/api/types";
import { useMe } from "@/lib/auth/use-me";
import {
  dueLabel,
  eventStatusTone,
  formatDateRange,
  formatMeetingWhen,
  meetingStatusTone,
  memberRoleLabel,
  taskStatusLabel,
  taskStatusTone,
  titleCase,
} from "@/lib/format";
import { KudosCard, MyPerformanceCard } from "@/components/platform/dashboard-cards";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api<DashboardSummary>("/dashboard/summary"),
  });

  if (isLoading || !data || !me) return <Spinner />;

  const firstName = me.user.name.split(" ")[0];
  const kindLabel = { member: "Member workspace", lead: "Lead workspace", admin: "Organization overview" }[data.kind];
  const work = data.myWork;

  return (
    <>
      <PageHeader eyebrow={kindLabel} title={`${greeting()}, ${firstName}`} description="Where your work, teams and events stand today." />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <MyPerformanceCard />
        <KudosCard />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="My open tasks" value={work.open} hint={work.overdue > 0 ? `${work.overdue} overdue` : "Nothing overdue"} icon={<ClipboardList className="size-4" />} />
        <Stat label="My progress" value={`${work.progress}%`} hint={`${work.completed}/${work.total} completed`} icon={<CheckCircle2 className="size-4" />} />
        {data.organization ? (
          <>
            <Stat label="People" value={data.organization.activeUsers} hint={`${data.organization.invitedUsers} invited`} icon={<Users className="size-4" />} />
            <Stat label="Org progress" value={`${data.organization.work.progress}%`} hint={`${data.organization.work.open} tasks open`} icon={<CalendarRange className="size-4" />} />
          </>
        ) : (
          <>
            <Stat label="My teams" value={data.myTeams.length} icon={<Users className="size-4" />} />
            <Stat label="My open events" value={data.activeEvents.length} icon={<CalendarRange className="size-4" />} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today's work"
            description="Your open tasks, soonest first"
            action={
              <Link href="/work" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                My Work <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {data.dueSoon.length === 0 ? (
            <EmptyState icon={<ClipboardList className="size-6" />} title="No open tasks" description="Tasks assigned to you appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {data.dueSoon.map((t) => {
                const due = dueLabel(t.dueDate);
                return (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-subtle">
                      <div className="min-w-40 flex-1">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                          {t.team && <span>{t.team.name}</span>}
                          {t.event && <span>{t.event.name}</span>}
                          <span className={due.tone === "danger" ? "text-danger" : due.tone === "warn" ? "text-warn" : undefined}>{due.text}</span>
                        </div>
                      </div>
                      <div className="w-24">
                        <ProgressBar value={t.percentage} />
                      </div>
                      <Badge tone={taskStatusTone[t.status]}>{taskStatusLabel[t.status]}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Next meetings"
              description={`Attendance ${data.myAttendance.attendanceRate}% across ${data.myAttendance.meetings} recorded meetings`}
              action={
                <Link href="/meetings" className="text-[13px] font-medium text-brand hover:underline">
                  All
                </Link>
              }
            />
            {data.nextMeetings.length === 0 ? (
              <EmptyState icon={<Video className="size-6" />} title="Nothing scheduled" description="Meetings you are invited to appear here." />
            ) : (
              <ul className="divide-y divide-line">
                {data.nextMeetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/meetings/${m.id}`} className="block px-5 py-3 hover:bg-subtle">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{m.title}</span>
                        <Badge tone={meetingStatusTone[m.status]}>{m.status === "LIVE" ? "Live" : titleCase(m.status)}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-ink-soft">
                        {formatMeetingWhen(m.scheduledStart, m.scheduledEnd)}
                        {m.team && ` · ${m.team.name}`}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.teamProgress.length > 0 && (
            <Card>
              <CardHeader title="Team progress" description={data.kind === "admin" ? "Your teams" : "Teams you lead"} />
              <div className="space-y-4 p-5">
                {data.teamProgress.map((t) => (
                  <Link key={t.id} href={`/teams/${t.id}`} className="block rounded-lg p-2 -m-2 hover:bg-subtle">
                    <ProgressBlock label={t.name} stats={t.stats} />
                  </Link>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="My teams" />
            {data.myTeams.length === 0 ? (
              <EmptyState title="Not on a team yet" description="A lead or administrator will add you." />
            ) : (
              <ul className="divide-y divide-line">
                {data.myTeams.map((t) => (
                  <li key={t.id}>
                    <Link href={`/teams/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.name}</div>
                        <div className="text-xs text-ink-soft">
                          {t._count.members} members · {t._count.events} events
                        </div>
                      </div>
                      <Badge tone={t.memberRole === "MEMBER" ? "neutral" : "brand"}>{memberRoleLabel[t.memberRole]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Events in motion"
          description={data.kind === "admin" ? "Planning and active events" : "Events you or your teams work on"}
          action={
            <Link href="/events" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              All events <ArrowRight className="size-3.5" />
            </Link>
          }
        />
        {data.activeEvents.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-6" />} title="No open events" />
        ) : (
          <ul className="divide-y divide-line">
            {data.activeEvents.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-subtle">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{e.name}</div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {formatDateRange(e.startDate, e.endDate)}
                      {e.venue && ` · ${e.venue}`}
                    </div>
                  </div>
                  <span className="hidden text-xs text-ink-faint sm:inline">{e._count.teams} teams</span>
                  <Badge tone={eventStatusTone[e.status]}>{titleCase(e.status)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

    </>
  );
}

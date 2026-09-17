"use client";

import { BarChart3, Download, Printer } from "lucide-react";
import { useState } from "react";
import { ProgressBar } from "@/components/tasks/task-bits";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Spinner, Stat } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import {
  type Score,
  downloadCsv,
  useActivityReport,
  useEventReport,
  useOrganizationReport,
  usePeoplePerformance,
  useTeamPerformance,
} from "@/features/reports/api";
import { eventStatusTone, formatDate, formatDateRange, formatMoney, titleCase } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";
import { ReportDownloadButton, SavedReports } from "@/components/platform/report-downloads";

type Tab = "organization" | "teams" | "people" | "event";

const TABS: { id: Tab; label: string }[] = [
  { id: "organization", label: "Organization" },
  { id: "teams", label: "Teams" },
  { id: "people", label: "People" },
  { id: "event", label: "Event" },
];

/** A score with its four signals, so nobody has to trust a bare number. */
function ScoreCell({ score }: { score: Score }) {
  if (score.score === null) return <span className="text-xs text-ink-faint">No data yet</span>;
  const { completion, deadlines, updates, attendance } = score.breakdown;
  const parts = [
    ["Completed", completion],
    ["On time", deadlines],
    ["Updated", updates],
    ["Attended", attendance],
  ] as const;

  return (
    <div className="min-w-44">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums">{score.score}%</span>
      </div>
      <ProgressBar value={score.score} tone={score.score >= 80 ? "ok" : "brand"} className="mt-1" />
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-faint">
        {parts
          .filter(([, v]) => v !== null)
          .map(([label, v]) => (
            <span key={label}>
              {label} {v}%
            </span>
          ))}
      </div>
    </div>
  );
}

function StatusCounts({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-faint">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {entries.map(([status, n]) => (
            <li key={status} className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">{titleCase(status)}</span>
              <span className="font-semibold tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>("organization");
  const [days, setDays] = useState(7);
  const [eventId, setEventId] = useState("");

  const events = useEvents();
  const org = useOrganizationReport(tab === "organization");
  const activity = useActivityReport(days, tab === "organization");
  const teams = useTeamPerformance(undefined, tab === "teams");
  const people = usePeoplePerformance({}, tab === "people");
  const eventReport = useEventReport(eventId, tab === "event" && !!eventId);
  const canExport = can("report.export");

  const exportCurrent = () => {
    if (tab === "teams" && teams.data) {
      downloadCsv(
        "team-performance.csv",
        teams.data.map((t) => ({
          Team: t.team.name,
          Score: t.score ?? "",
          Members: t.members,
          Tasks: t.work.tasksTotal,
          Completed: t.work.tasksCompleted,
          OnTime: t.work.tasksOnTime,
          MeetingsAttended: `${t.work.meetingsAttended}/${t.work.meetingsTotal}`,
        })),
      );
    }
    if (tab === "people" && people.data) {
      downloadCsv(
        "people-performance.csv",
        people.data.map((p) => ({
          Person: p.person.name,
          Score: p.score ?? "",
          Tasks: p.work.tasksTotal,
          Completed: p.work.tasksCompleted,
          OnTime: p.work.tasksOnTime,
          MeetingsAttended: `${p.work.meetingsAttended}/${p.work.meetingsTotal}`,
        })),
      );
    }
    if (tab === "event" && eventReport.data) {
      downloadCsv(
        `${eventReport.data.event.name}-teams.csv`,
        eventReport.data.teams.map((t) => ({ Team: t.team.name, Score: t.score ?? "", Tasks: t.work.tasksTotal, Completed: t.work.tasksCompleted })),
      );
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="05 · Knowledge"
        title="Reports"
        description="Built from the work already recorded — tasks, updates, meetings, attendance, money. Nothing is typed twice."
        actions={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" /> Print
            </Button>
            {canExport && <ReportDownloadButton />}
            {canExport && tab !== "organization" && (
              <Button variant="secondary" onClick={exportCurrent}>
                <Download className="size-4" /> Export CSV
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Report">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "organization" && (
        <>
          {org.isLoading || !org.data ? (
            <Spinner />
          ) : (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="p-5">
                  <div className="text-[13px] text-ink-soft">Overall performance</div>
                  <div className="mt-2">
                    <ScoreCell score={org.data.performance} />
                  </div>
                </Card>
                <Stat label="Tasks completed" value={`${org.data.work.tasksCompleted}/${org.data.work.tasksTotal}`} hint={`${org.data.work.tasksActive} still open`} />
                <Stat label="Active people" value={org.data.people.ACTIVE ?? 0} hint={`${org.data.teams} teams`} />
                {org.data.finance ? (
                  <Stat label="Spent" value={formatMoney(org.data.finance.spent)} hint={`${formatMoney(org.data.finance.remaining)} left of budget`} />
                ) : (
                  <Stat label="Meetings attended" value={`${org.data.work.meetingsAttended}/${org.data.work.meetingsTotal}`} />
                )}
              </div>

              <Card className="mb-6">
                <CardHeader
                  title="Activity"
                  description="What actually happened in this period."
                  action={
                    <Select className="h-9 w-36" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
                      <option value={1}>Last 24 hours</option>
                      <option value={7}>Last 7 days</option>
                      <option value={30}>Last 30 days</option>
                      <option value={90}>Last 90 days</option>
                    </Select>
                  }
                />
                {activity.data && (
                  <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ["Tasks created", activity.data.tasksCreated],
                      ["Tasks completed", activity.data.tasksCompleted],
                      ["Work updates", activity.data.workUpdates],
                      ["Meetings held", activity.data.meetingsHeld],
                      ["Tickets opened", activity.data.ticketsOpened],
                      ["Tickets resolved", activity.data.ticketsResolved],
                      ["Expenses submitted", activity.data.expensesSubmitted],
                      ["Ideas submitted", activity.data.ideasSubmitted],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="bg-surface px-5 py-4">
                        <div className="text-xs text-ink-faint">{label}</div>
                        <div className="text-2xl font-semibold tabular-nums">{value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatusCounts title="Events" counts={org.data.events} />
                <StatusCounts title="Tickets" counts={org.data.tickets} />
                <StatusCounts title="Ideas" counts={org.data.ideas} />
                <StatusCounts title="Opportunities" counts={org.data.opportunities} />
              </div>
            </>
          )}
        </>
      )}

      {tab === "teams" && (
        <Card>
          <CardHeader title="Team performance" description="Score from completion, deadlines, work updates and attendance." />
          {teams.isLoading ? (
            <Spinner />
          ) : !teams.data?.length ? (
            <EmptyState icon={<BarChart3 className="size-6" />} title="No teams to report on" />
          ) : (
            <ul className="divide-y divide-line">
              {teams.data.map((t) => (
                <li key={t.team.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-40 flex-1">
                    <div className="text-sm font-medium">{t.team.name}</div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {t.members} members
                      {t.leads.length > 0 && ` · led by ${t.leads.map((l) => l.name).join(", ")}`}
                    </div>
                  </div>
                  <span className="text-xs text-ink-faint">
                    {t.work.tasksCompleted}/{t.work.tasksTotal} tasks
                  </span>
                  <ScoreCell score={t} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "people" && (
        <Card>
          <CardHeader
            title="People"
            description="Individual work records. Attendance is participation data, not a verdict — read it with the other signals."
          />
          {people.isLoading ? (
            <Spinner />
          ) : !people.data?.length ? (
            <EmptyState icon={<BarChart3 className="size-6" />} title="Nothing to report yet" description="Scores appear once people have tasks or meetings." />
          ) : (
            <ul className="divide-y divide-line">
              {people.data.map((p) => (
                <li key={p.person.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <Avatar name={p.person.name} src={p.person.avatarUrl} size={30} />
                  <div className="min-w-32 flex-1">
                    <div className="text-sm font-medium">{p.person.name}</div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {p.work.tasksCompleted}/{p.work.tasksTotal} tasks · {p.work.meetingsAttended}/{p.work.meetingsTotal} meetings
                    </div>
                  </div>
                  <ScoreCell score={p} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "event" && (
        <>
          <Card className="mb-6 p-5">
            <Select className="max-w-sm" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
              <option value="">Choose an event…</option>
              {events.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Card>

          {eventId && (eventReport.isLoading || !eventReport.data) ? (
            <Spinner />
          ) : eventReport.data ? (
            <>
              <Card className="mb-6 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">{eventReport.data.event.name}</h2>
                  <Badge tone={eventStatusTone[eventReport.data.event.status as keyof typeof eventStatusTone]}>
                    {titleCase(eventReport.data.event.status)}
                  </Badge>
                  <span className="text-[13px] text-ink-soft">
                    {formatDateRange(eventReport.data.event.startDate, eventReport.data.event.endDate)}
                    {eventReport.data.event.venue && ` · ${eventReport.data.event.venue}`}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">Generated {formatDate(eventReport.data.generatedAt)}</span>
                </div>

                <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs text-ink-faint">Event performance</div>
                    <ScoreCell score={eventReport.data.performance} />
                  </div>
                  <div>
                    <div className="text-xs text-ink-faint">Tasks</div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {eventReport.data.work.tasksCompleted}/{eventReport.data.work.tasksTotal}
                    </div>
                    <div className="text-xs text-ink-soft">{eventReport.data.work.tasksActive} still open</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-faint">Meetings attended</div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {eventReport.data.work.meetingsAttended}/{eventReport.data.work.meetingsTotal}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-faint">Budget</div>
                    {eventReport.data.finance ? (
                      <>
                        <div className="text-2xl font-semibold tabular-nums">{formatMoney(eventReport.data.finance.spent)}</div>
                        <div className="text-xs text-ink-soft">of {formatMoney(eventReport.data.finance.allocated)} allocated</div>
                      </>
                    ) : (
                      <div className="text-sm text-ink-faint">Restricted</div>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="mb-6">
                <CardHeader title="Teams on this event" />
                {eventReport.data.teams.length === 0 ? (
                  <EmptyState title="No teams assigned" />
                ) : (
                  <ul className="divide-y divide-line">
                    {eventReport.data.teams.map((t) => (
                      <li key={t.team.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                        <div className="min-w-32 flex-1 text-sm font-medium">{t.team.name}</div>
                        <span className="text-xs text-ink-faint">
                          {t.work.tasksCompleted}/{t.work.tasksTotal} tasks
                        </span>
                        <ScoreCell score={t} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="grid gap-4 sm:grid-cols-3">
                <StatusCounts title="Meetings" counts={eventReport.data.meetings} />
                <StatusCounts title="Tickets" counts={eventReport.data.tickets} />
                <Card className="p-5">
                  <h3 className="text-[15px] font-semibold">Opportunities</h3>
                  {eventReport.data.opportunities.length === 0 ? (
                    <p className="mt-2 text-[13px] text-ink-faint">Nothing recorded yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {eventReport.data.opportunities.map((o) => (
                        <li key={`${o.type}-${o.status}`} className="flex items-center justify-between text-sm">
                          <span className="text-ink-soft">
                            {titleCase(o.type)} · {titleCase(o.status)}
                          </span>
                          <span className="font-semibold tabular-nums">{o.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-xs text-ink-faint">{eventReport.data.ideas} ideas submitted for this event.</p>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <EmptyState icon={<BarChart3 className="size-6" />} title="Pick an event" description="Choose an event above to see its full report." />
            </Card>
          )}
        </>
      )}
      <SavedReports />
    </>
  );
}

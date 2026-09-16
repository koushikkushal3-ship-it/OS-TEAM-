"use client";

import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { type CalendarEntry, useCalendar, useFeedToken, useRotateFeedToken } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { formatTime } from "@/lib/format";

const KIND: Record<CalendarEntry["kind"], { label: string; tone: "brand" | "warn" | "ok" | "neutral" | "master" | "danger" }> = {
  meeting: { label: "Meeting", tone: "brand" },
  task: { label: "Due", tone: "warn" },
  shift: { label: "Shift", tone: "master" },
  leave: { label: "Leave", tone: "neutral" },
  event: { label: "Event", tone: "ok" },
  run: { label: "Run of show", tone: "danger" },
  schedule: { label: "Schedule", tone: "brand" },
};

const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });
const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

/** Spreads multi-day items (events, leave) over every day they cover. */
function byDay(items: CalendarEntry[], from: Date, to: Date) {
  const days = new Map<string, CalendarEntry[]>();
  for (const item of items) {
    const start = new Date(item.start);
    const end = item.end ? new Date(item.end) : start;
    const cursor = new Date(Math.max(start.getTime(), from.getTime()));
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(Math.min(end.getTime(), to.getTime()));
    for (let guard = 0; cursor <= last && guard < 62; guard++) {
      const key = dayKey(cursor);
      days.set(key, [...(days.get(key) ?? []), item]);
      if (!item.allDay && !item.end) break;
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function Subscribe() {
  const { data } = useFeedToken();
  const rotate = useRotateFeedToken();
  const [copied, setCopied] = useState(false);
  const url = data?.token ? `${window.location.origin}/api/calendar/feed/${data.token}.ics` : null;

  return (
    <Card className="mt-6">
      <CardHeader
        title="Add to Google Calendar"
        description="A private link that keeps your TEAM OS calendar in sync. Anyone with the link can read your schedule, so keep it to yourself; making a new link switches the old one off."
      />
      <div className="space-y-3 px-5 pb-5">
        {url ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-xs">{url}</code>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <Copy className="size-4" /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-ink-soft">No link yet.</p>
        )}
        <Button variant="secondary" loading={rotate.isPending} onClick={() => rotate.mutate()}>
          <RefreshCw className="size-4" /> {url ? "Make a new link" : "Create my link"}
        </Button>
        {rotate.error && <ErrorNote>{errorMessage(rotate.error)}</ErrorNote>}
        <p className="text-xs text-ink-faint">
          In Google Calendar: Other calendars → + → From URL → paste. Google can only reach the link once TEAM OS is on a public web address; while it runs on this computer, the link works in calendar apps on this computer only.
        </p>
      </div>
    </Card>
  );
}

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const from = anchor;
  const to = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59), [anchor]);
  const { data, isLoading, error } = useCalendar(from, to);
  const days = useMemo(() => (data ? byDay(data, from, to) : []), [data, from, to]);
  const today = dayKey(new Date());
  const shift = (n: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + n, 1));

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="My calendar"
        description="Your meetings, due dates, shifts, events and leave in one place."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-medium">{monthLabel.format(anchor)}</span>
            <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />
      {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : days.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-6" />} title="A quiet month" description="Nothing scheduled for you." />
        ) : (
          <ol className="divide-y divide-line">
            {days.map(([key, items]) => (
              <li key={key} className={clsx("grid gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr]", key === today && "bg-brand-soft/40")}>
                <div className="text-[13px] font-medium">
                  {dayLabel.format(new Date(`${key}T00:00:00`))}
                  {key === today && <Badge tone="brand" className="ml-2">Today</Badge>}
                </div>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li key={`${key}-${item.id}`}>
                      <Link href={item.link} className="flex flex-wrap items-center gap-2 rounded-md text-sm hover:underline">
                        <Badge tone={KIND[item.kind].tone}>{KIND[item.kind].label}</Badge>
                        <span className="w-12 font-mono text-xs text-ink-faint">{item.allDay ? "all day" : formatTime(item.start)}</span>
                        <span>{item.title}</span>
                        {item.location && <span className="truncate text-xs text-ink-faint">· {item.location}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Subscribe />
    </>
  );
}

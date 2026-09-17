"use client";

import clsx from "clsx";
import { CalendarDays, Copy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarToolbar, MonthCalendar, dayKey, dayLabel, firstOfMonth, monthGrid, spreadByDay } from "@/components/platform/month-calendar";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { type CalendarEntry, useCalendar, useFeedToken, useRotateFeedToken } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { formatTime } from "@/lib/format";

type Tone = "brand" | "warn" | "ok" | "neutral" | "master" | "danger";

const KIND: Record<CalendarEntry["kind"], { label: string; tone: Tone }> = {
  meeting: { label: "Meeting", tone: "brand" },
  task: { label: "Due", tone: "warn" },
  shift: { label: "Shift", tone: "master" },
  leave: { label: "Leave", tone: "neutral" },
  event: { label: "Event", tone: "ok" },
  run: { label: "Run of show", tone: "danger" },
  schedule: { label: "Schedule", tone: "brand" },
};

/** Chip colours per kind; the schedule gets its own so it stands apart from meetings. */
const CHIP: Record<CalendarEntry["kind"], string> = {
  meeting: "bg-brand-soft text-brand-strong border-brand/20",
  task: "bg-warn-soft text-warn border-warn/20",
  shift: "bg-master-soft text-master border-master/20",
  leave: "bg-subtle text-ink-soft border-line",
  event: "bg-ok-soft text-ok border-ok/20",
  run: "bg-danger-soft text-danger border-danger/20",
  schedule: "bg-sky-50 text-sky-800 border-sky-200",
};
const DOT: Record<CalendarEntry["kind"], string> = {
  meeting: "bg-brand",
  task: "bg-warn",
  shift: "bg-master",
  leave: "bg-ink-faint",
  event: "bg-ok",
  run: "bg-danger",
  schedule: "bg-sky-500",
};

function ItemRow({ item }: { item: CalendarEntry }) {
  return (
    <Link href={item.link} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-subtle">
      <Badge tone={KIND[item.kind].tone}>{KIND[item.kind].label}</Badge>
      <span className="w-24 font-mono text-xs text-ink-faint">{item.allDay ? "all day" : `${formatTime(item.start)}${item.end ? `–${formatTime(item.end)}` : ""}`}</span>
      <span className="font-medium">{item.title}</span>
      {item.location && <span className="truncate text-xs text-ink-faint">· {item.location}</span>}
    </Link>
  );
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
          Don&apos;t open this link in the browser — paste it in Google Calendar: Other calendars → + → From URL. Google can only reach it once TEAM OS is on a public web address. The organization Schedule is already shared to your Google Calendar separately.
        </p>
      </div>
    </Card>
  );
}

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => firstOfMonth());
  const [today] = useState(() => dayKey(new Date()));
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<"month" | "list">("month");

  // Fetch the whole visible grid, so spill-over days from the months either side are filled in too.
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const { data, isLoading, error } = useCalendar(grid.start, grid.end);
  const byDate = useMemo(() => (data ? spreadByDay(data, grid.start, grid.end) : new Map<string, CalendarEntry[]>()), [data, grid]);
  const monthDays = useMemo(() => [...byDate.entries()].filter(([key]) => key.startsWith(dayKey(anchor).slice(0, 7))).sort(([a], [b]) => a.localeCompare(b)), [byDate, anchor]);
  const selectedItems = byDate.get(selected) ?? [];
  const kindsShown = useMemo(() => new Set((data ?? []).map((i) => i.kind)), [data]);

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="My calendar"
        description="Your meetings, due dates, shifts, events, leave and the organization schedule — filled in from what is recorded in TEAM OS."
        actions={
          <CalendarToolbar
            anchor={anchor}
            view={view}
            onView={setView}
            onMonth={(n) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + n, 1))}
            onToday={() => {
              setAnchor(firstOfMonth());
              setSelected(today);
            }}
          />
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(error)}</ErrorNote>
        </div>
      )}

      {kindsShown.size > 0 && (
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-ink-soft">
          {(Object.keys(KIND) as CalendarEntry["kind"][])
            .filter((k) => kindsShown.has(k))
            .map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={clsx("size-2.5 rounded-full", DOT[k])} />
                {KIND[k].label}
              </span>
            ))}
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : view === "month" ? (
        <>
          <MonthCalendar anchor={anchor} days={grid.days} byDate={byDate} selected={selected} onSelect={setSelected} today={today} chipClass={(i) => CHIP[i.kind]} dotClass={(i) => DOT[i.kind]} />
          <Card className="mt-4">
            <CardHeader title={dayLabel.format(new Date(`${selected}T00:00:00`))} description={selectedItems.length ? `${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}` : "Nothing on this day"} />
            {selectedItems.length > 0 && (
              <ul className="space-y-0.5 px-3 pb-3">
                {selectedItems.map((item) => (
                  <li key={item.id}>
                    <ItemRow item={item} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <Card>
          {monthDays.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-6" />} title="A quiet month" description="Nothing scheduled for you." />
          ) : (
            <ol className="divide-y divide-line">
              {monthDays.map(([key, items]) => (
                <li key={key} className={clsx("grid gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr]", key === today && "bg-brand-soft/40")}>
                  <div className="text-[13px] font-medium">
                    {dayLabel.format(new Date(`${key}T00:00:00`))}
                    {key === today && (
                      <Badge tone="brand" className="ml-2">
                        Today
                      </Badge>
                    )}
                  </div>
                  <ul className="space-y-0.5">
                    {items.map((item) => (
                      <li key={`${key}-${item.id}`}>
                        <ItemRow item={item} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <Subscribe />
    </>
  );
}

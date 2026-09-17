"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { formatTime } from "@/lib/format";

/** Anything that can sit on the month grid. */
export interface GridItem {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  allDay?: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

export const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
export const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });
export const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

export const firstOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Sunday-to-Saturday weeks covering the whole month, including the spill-over days either side. */
export function monthGrid(anchor: Date) {
  const first = firstOfMonth(anchor);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));
  end.setHours(23, 59, 59, 999);
  const days: Date[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  return { start, end, days };
}

/** Places each item on every day it covers, all-day items first, then by start time. */
export function spreadByDay<T extends GridItem>(items: T[], from: Date, to: Date) {
  const days = new Map<string, T[]>();
  for (const item of items) {
    const start = new Date(item.start);
    const end = item.end ? new Date(item.end) : start;
    const cursor = new Date(Math.max(start.getTime(), from.getTime()));
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(Math.min(end.getTime(), to.getTime()));
    for (let guard = 0; cursor <= last && guard < 62; guard++) {
      const key = dayKey(cursor);
      days.set(key, [...(days.get(key) ?? []), item]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  for (const list of days.values()) list.sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime());
  return days;
}

/** Month / List switch, Today and previous/next month — shared by every calendar page. */
export function CalendarToolbar({
  anchor,
  view,
  onView,
  onMonth,
  onToday,
  children,
}: {
  anchor: Date;
  view: "month" | "list";
  onView: (v: "month" | "list") => void;
  onMonth: (step: number) => void;
  onToday: () => void;
  children?: ReactNode;
}) {
  const nav = "grid size-8 place-items-center rounded-lg border border-line-strong bg-surface text-ink hover:bg-subtle";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Calendar view">
        {(["month", "list"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => onView(v)} className="rounded-md px-3 py-1 text-[13px] text-ink-soft aria-selected:bg-ink aria-selected:text-white">
            {v === "month" ? "Month" : "List"}
          </button>
        ))}
      </div>
      <button type="button" onClick={onToday} className="h-8 rounded-lg border border-line-strong bg-surface px-3 text-[13px] hover:bg-subtle">
        Today
      </button>
      <button type="button" aria-label="Previous month" onClick={() => onMonth(-1)} className={nav}>
        ‹
      </button>
      <span className="min-w-36 text-center text-sm font-medium">{monthLabel.format(anchor)}</span>
      <button type="button" aria-label="Next month" onClick={() => onMonth(1)} className={nav}>
        ›
      </button>
      {children}
    </div>
  );
}

export function MonthCalendar<T extends GridItem>({
  anchor,
  days,
  byDate,
  selected,
  onSelect,
  today,
  chipClass,
  dotClass,
}: {
  anchor: Date;
  days: Date[];
  byDate: Map<string, T[]>;
  selected: string;
  onSelect: (key: string) => void;
  today: string;
  chipClass: (item: T) => string;
  dotClass: (item: T) => string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line bg-subtle text-center text-[11px] font-medium tracking-wide text-ink-soft uppercase">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date, i) => {
          const key = dayKey(date);
          const items = byDate.get(key) ?? [];
          const inMonth = date.getMonth() === anchor.getMonth();
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-label={`${dayLabel.format(date)}, ${items.length} item${items.length === 1 ? "" : "s"}`}
              aria-pressed={selected === key}
              className={clsx(
                "flex min-h-16 flex-col gap-1 border-line p-1.5 text-left transition-colors hover:bg-subtle sm:min-h-28",
                i % 7 !== 6 && "border-r",
                i < days.length - 7 && "border-b",
                !inMonth && "bg-canvas/60",
                selected === key && "bg-brand-soft/50 ring-2 ring-brand ring-inset",
              )}
            >
              <span className={clsx("grid size-6 place-items-center rounded-full text-xs", key === today ? "bg-brand font-semibold text-white" : inMonth ? "text-ink" : "text-ink-faint")}>
                {date.getDate()}
              </span>

              {/* Phones: coloured dots. Larger screens: readable chips. */}
              {items.length > 0 && (
                <span className="flex flex-wrap gap-0.5 sm:hidden">
                  {items.slice(0, 4).map((item) => (
                    <span key={item.id} className={clsx("size-1.5 rounded-full", dotClass(item))} />
                  ))}
                </span>
              )}
              <span className="hidden w-full flex-col gap-0.5 sm:flex">
                {items.slice(0, MAX_CHIPS).map((item) => (
                  <span key={item.id} className={clsx("truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight", chipClass(item), !inMonth && "opacity-60")} title={item.title}>
                    {!item.allDay && <span className="mr-1 font-mono opacity-80">{formatTime(item.start)}</span>}
                    {item.title}
                  </span>
                ))}
                {items.length > MAX_CHIPS && <span className="px-1 text-[11px] font-medium text-ink-soft">+{items.length - MAX_CHIPS} more</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

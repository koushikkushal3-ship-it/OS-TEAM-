"use client";

import clsx from "clsx";
import { CalendarCheck2, ExternalLink, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { CalendarToolbar, MonthCalendar, dayKey, dayLabel, firstOfMonth, monthGrid, spreadByDay } from "@/components/platform/month-calendar";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import { useDepartments } from "@/features/people/api";
import { type ScheduleEntry, type ScheduleScope, useSchedule, useScheduleActions } from "@/features/platform/schedule";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import { formatTime, titleCase, toDateInput, toDateTimeInput } from "@/lib/format";

const CATEGORIES = ["General", "Meeting", "Event", "Deadline", "Holiday", "Training", "Rehearsal"];

/** One colour per category, so the month reads at a glance. */
const CATEGORY_CHIP: Record<string, string> = {
  General: "bg-sky-50 text-sky-800 border-sky-200",
  Meeting: "bg-brand-soft text-brand-strong border-brand/20",
  Event: "bg-ok-soft text-ok border-ok/20",
  Deadline: "bg-danger-soft text-danger border-danger/20",
  Holiday: "bg-warn-soft text-warn border-warn/20",
  Training: "bg-master-soft text-master border-master/20",
  Rehearsal: "bg-violet-50 text-violet-800 border-violet-200",
};
const CATEGORY_DOT: Record<string, string> = {
  General: "bg-sky-500",
  Meeting: "bg-brand",
  Event: "bg-ok",
  Deadline: "bg-danger",
  Holiday: "bg-warn",
  Training: "bg-master",
  Rehearsal: "bg-violet-500",
};

type GridEntry = ScheduleEntry & { start: string; end: string };

function EntryDialog({ entry, day, onClose }: { entry?: ScheduleEntry; day?: string; onClose: () => void }) {
  const { save } = useScheduleActions();
  const teams = useTeams();
  const events = useEvents();
  const departments = useDepartments();
  const now = new Date();
  const [form, setForm] = useState({
    title: entry?.title ?? "",
    description: entry?.description ?? "",
    location: entry?.location ?? "",
    allDay: entry?.allDay ?? false,
    // A new entry opened from a calendar day starts on that day, 9 to 10 in the morning.
    start: entry ? (entry.allDay ? toDateInput(entry.startsAt) : toDateTimeInput(entry.startsAt)) : day ? `${day}T09:00` : toDateTimeInput(now.toISOString()),
    end: entry ? (entry.allDay ? toDateInput(entry.endsAt) : toDateTimeInput(entry.endsAt)) : day ? `${day}T10:00` : toDateTimeInput(new Date(now.getTime() + 3_600_000).toISOString()),
    scopeType: entry?.scopeType ?? ("ORGANIZATION" as ScheduleScope),
    scopeId: entry?.scopeId ?? "",
    category: entry?.category ?? "General",
  });
  const options = form.scopeType === "TEAM" ? teams.data : form.scopeType === "EVENT" ? events.data : form.scopeType === "DEPARTMENT" ? departments.data : [];

  const toggleAllDay = (allDay: boolean) =>
    setForm((f) => ({ ...f, allDay, start: allDay ? f.start.slice(0, 10) : `${f.start.slice(0, 10)}T09:00`, end: allDay ? f.end.slice(0, 10) : `${f.end.slice(0, 10)}T10:00` }));

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={entry ? `Edit · ${entry.title}` : "Add to the schedule"}
      description="Everyone it is meant for sees it in the portal right away, and it is copied to the organization's Google Calendar."
      submitLabel={entry ? "Save" : "Add to schedule"}
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            id: entry?.id,
            title: form.title,
            description: form.description || null,
            location: form.location || null,
            allDay: form.allDay,
            startsAt: new Date(form.allDay ? `${form.start}T00:00:00` : form.start).toISOString(),
            endsAt: new Date(form.allDay ? `${form.end}T23:59:00` : form.end).toISOString(),
            scopeType: form.scopeType,
            scopeId: form.scopeType === "ORGANIZATION" ? null : form.scopeId,
            category: form.category,
          },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor="sc-title">
          <Input id="sc-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Annual general meeting" />
        </Field>
        <Field label="Category" htmlFor="sc-cat">
          <Select id="sc-cat" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-4 accent-brand" checked={form.allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
          All day
        </label>
        <Field label="Starts" htmlFor="sc-start">
          <Input id="sc-start" type={form.allDay ? "date" : "datetime-local"} required value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
        </Field>
        <Field label="Ends" htmlFor="sc-end">
          <Input id="sc-end" type={form.allDay ? "date" : "datetime-local"} required min={form.start} value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
        </Field>
        <Field label="For" htmlFor="sc-scope">
          <Select id="sc-scope" value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as ScheduleScope, scopeId: "" }))}>
            <option value="ORGANIZATION">Everyone</option>
            <option value="DEPARTMENT">One department</option>
            <option value="TEAM">One team</option>
            <option value="EVENT">One event</option>
          </Select>
        </Field>
        {form.scopeType !== "ORGANIZATION" ? (
          <Field label={titleCase(form.scopeType)} htmlFor="sc-scope-id">
            <Select id="sc-scope-id" required value={form.scopeId} onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}>
              <option value="">Select…</option>
              {options?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Where" htmlFor="sc-loc">
            <Input id="sc-loc" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Main hall" />
          </Field>
        )}
        {form.scopeType !== "ORGANIZATION" && (
          <div className="sm:col-span-2">
            <Field label="Where" htmlFor="sc-loc2">
              <Input id="sc-loc2" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Details" htmlFor="sc-desc">
            <Textarea id="sc-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

export default function SchedulePage() {
  const [anchor, setAnchor] = useState(() => firstOfMonth());
  const [today] = useState(() => dayKey(new Date()));
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<"month" | "list">("month");
  const [editing, setEditing] = useState<ScheduleEntry | "new" | null>(null);

  // The whole visible grid, so days from the neighbouring months are filled in too.
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const { data, isLoading, error } = useSchedule(grid.start, grid.end);
  const { remove } = useScheduleActions();

  const byDate = useMemo(() => {
    const items: GridEntry[] = (data?.items ?? []).map((e) => ({ ...e, start: e.startsAt, end: e.endsAt }));
    return spreadByDay(items, grid.start, grid.end);
  }, [data, grid]);
  const monthDays = useMemo(() => [...byDate.entries()].filter(([key]) => key.startsWith(dayKey(anchor).slice(0, 7))).sort(([a], [b]) => a.localeCompare(b)), [byDate, anchor]);
  const categoriesShown = useMemo(() => [...new Set((data?.items ?? []).map((e) => e.category))], [data]);

  const canManage = data?.capabilities.canManage;
  const selectedItems = byDate.get(selected) ?? [];

  const entryRow = (e: GridEntry) => (
    <li key={e.id} className="flex flex-wrap items-start gap-2 rounded-md px-2 py-1.5 hover:bg-subtle">
      <span className={clsx("mt-1.5 size-2.5 shrink-0 rounded-full", CATEGORY_DOT[e.category] ?? "bg-sky-500")} />
      <span className="w-24 pt-0.5 font-mono text-xs text-ink-faint">{e.allDay ? "all day" : `${formatTime(e.startsAt)}–${formatTime(e.endsAt)}`}</span>
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {e.title}
          <Badge>{e.category}</Badge>
          {e.audience !== "Everyone" && <Badge tone="brand">{e.audience}</Badge>}
          {canManage && data?.google.connected && (e.googleSyncError ? <Badge tone="danger">Not in Google yet</Badge> : !e.googleSynced ? <Badge tone="warn">Copying to Google…</Badge> : null)}
        </div>
        {e.location && (
          <div className="flex items-center gap-1 text-xs text-ink-soft">
            <MapPin className="size-3" /> {e.location}
          </div>
        )}
        {e.description && <p className="mt-0.5 text-[13px] whitespace-pre-line text-ink-soft">{e.description}</p>}
      </div>
      {e.canEdit && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label={`Edit ${e.title}`} onClick={() => setEditing(e)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${e.title}`} onClick={() => confirm(`Remove "${e.title}" from the schedule?`) && remove.mutate(e.id)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="Schedule"
        description={canManage ? "The organization's shared schedule. What you add here appears for everyone it is meant for and in the Google Calendar." : "The organization's shared schedule, kept by administrators and leads."}
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
          >
            {data?.google.calendarUrl && (
              <a href={data.google.calendarUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] hover:bg-subtle">
                <CalendarCheck2 className="size-4" /> Google Calendar <ExternalLink className="size-3" />
              </a>
            )}
            {canManage && (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus className="size-4" /> Add
              </Button>
            )}
          </CalendarToolbar>
        }
      />

      {(error ?? remove.error) && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(error ?? remove.error)}</ErrorNote>
        </div>
      )}

      {categoriesShown.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-ink-soft">
          {categoriesShown.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className={clsx("size-2.5 rounded-full", CATEGORY_DOT[c] ?? "bg-sky-500")} />
              {c}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : view === "month" ? (
        <>
          <MonthCalendar
            anchor={anchor}
            days={grid.days}
            byDate={byDate}
            selected={selected}
            onSelect={setSelected}
            today={today}
            chipClass={(e) => CATEGORY_CHIP[e.category] ?? CATEGORY_CHIP.General}
            dotClass={(e) => CATEGORY_DOT[e.category] ?? CATEGORY_DOT.General}
          />
          <Card className="mt-4">
            <CardHeader
              title={dayLabel.format(new Date(`${selected}T00:00:00`))}
              description={selectedItems.length ? `${selectedItems.length} entr${selectedItems.length === 1 ? "y" : "ies"}` : "Nothing scheduled on this day"}
              action={
                canManage && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
                    <Plus className="size-3.5" /> Add on this day
                  </Button>
                )
              }
            />
            {selectedItems.length > 0 && <ul className="space-y-0.5 px-3 pb-3">{selectedItems.map(entryRow)}</ul>}
          </Card>
        </>
      ) : (
        <Card>
          {monthDays.length === 0 ? (
            <EmptyState icon={<CalendarCheck2 className="size-6" />} title="Nothing scheduled this month" />
          ) : (
            <ol className="divide-y divide-line">
              {monthDays.map(([key, entries]) => (
                <li key={key} className={clsx("grid gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr]", key === today && "bg-brand-soft/40")}>
                  <div className="text-[13px] font-medium">
                    {dayLabel.format(new Date(`${key}T00:00:00`))}
                    {key === today && (
                      <Badge tone="brand" className="ml-2">
                        Today
                      </Badge>
                    )}
                  </div>
                  <ul className="space-y-0.5">{entries.map(entryRow)}</ul>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {editing && (
        <EntryDialog
          key={editing === "new" ? `new-${view === "month" ? selected : ""}` : editing.id}
          entry={editing === "new" ? undefined : editing}
          day={editing === "new" && view === "month" ? selected : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

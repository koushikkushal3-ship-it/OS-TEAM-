"use client";

import clsx from "clsx";
import { CalendarCheck2, ChevronLeft, ChevronRight, ExternalLink, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import { useDepartments } from "@/features/people/api";
import { type ScheduleEntry, type ScheduleScope, useSchedule, useScheduleActions } from "@/features/platform/schedule";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import { formatTime, titleCase, toDateInput, toDateTimeInput } from "@/lib/format";

const CATEGORIES = ["General", "Meeting", "Event", "Deadline", "Holiday", "Training", "Rehearsal"];
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");
const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });
const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

function EntryDialog({ entry, onClose }: { entry?: ScheduleEntry; onClose: () => void }) {
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
    start: entry ? (entry.allDay ? toDateInput(entry.startsAt) : toDateTimeInput(entry.startsAt)) : toDateTimeInput(now.toISOString()),
    end: entry ? (entry.allDay ? toDateInput(entry.endsAt) : toDateTimeInput(entry.endsAt)) : toDateTimeInput(new Date(now.getTime() + 3_600_000).toISOString()),
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
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const to = useMemo(() => new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59), [anchor]);
  const { data, isLoading, error } = useSchedule(anchor, to);
  const { remove } = useScheduleActions();
  const [editing, setEditing] = useState<ScheduleEntry | "new" | null>(null);
  const [today] = useState(() => dayKey(new Date()));

  const days = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const e of data?.items ?? []) {
      const key = dayKey(new Date(Math.max(new Date(e.startsAt).getTime(), anchor.getTime())));
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, anchor]);

  const canManage = data?.capabilities.canManage;
  const shift = (n: number) => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + n, 1));

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="Schedule"
        description={canManage ? "The organization's shared schedule. What you add here appears for everyone it is meant for and in the Google Calendar." : "The organization's shared schedule, kept by administrators and leads."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data?.google.calendarUrl && (
              <a href={data.google.calendarUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-subtle">
                <CalendarCheck2 className="size-4" /> Google Calendar <ExternalLink className="size-3" />
              </a>
            )}
            <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-medium">{monthLabel.format(anchor)}</span>
            <Button variant="secondary" size="sm" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
            {canManage && (
              <Button onClick={() => setEditing("new")}>
                <Plus className="size-4" /> Add
              </Button>
            )}
          </div>
        }
      />
      {(error ?? remove.error) && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(error ?? remove.error)}</ErrorNote>
        </div>
      )}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : days.length === 0 ? (
          <EmptyState icon={<CalendarCheck2 className="size-6" />} title="Nothing scheduled this month" />
        ) : (
          <ol className="divide-y divide-line">
            {days.map(([key, entries]) => (
              <li key={key} className={clsx("grid gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr]", key === today && "bg-brand-soft/40")}>
                <div className="text-[13px] font-medium">
                  {dayLabel.format(new Date(`${key}T00:00:00`))}
                  {key === today && <Badge tone="brand" className="ml-2">Today</Badge>}
                </div>
                <ul className="space-y-2">
                  {entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-start gap-2">
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
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {editing && <EntryDialog key={editing === "new" ? "new" : editing.id} entry={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

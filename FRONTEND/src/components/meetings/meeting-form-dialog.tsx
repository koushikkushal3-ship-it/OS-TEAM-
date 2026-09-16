"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import type { MeetingInput } from "@/features/meetings/api";
import { usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { MeetingDetail, MeetingType } from "@/lib/api/types";
import { meetingTypeLabel, toDateTimeInput } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const TYPES: MeetingType[] = ["GOOGLE_MEET", "INTERNAL", "PHYSICAL", "WORKSHOP", "ONE_TO_ONE", "EXTERNAL", "EVENT", "CUSTOM"];

/** One hour from the next half hour, in local time. */
function defaultSlot() {
  const start = new Date();
  start.setMinutes(start.getMinutes() > 30 ? 60 : 30, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { start: toDateTimeInput(start.toISOString()), end: toDateTimeInput(end.toISOString()) };
}

export function MeetingFormDialog({
  mode,
  open,
  initial,
  fixed,
  onClose,
  onSave,
  saving,
  error,
}: {
  mode: "create" | "edit";
  open: boolean;
  initial?: Partial<MeetingDetail>;
  fixed?: { teamId?: string; eventId?: string };
  onClose: () => void;
  onSave: (input: MeetingInput) => void;
  saving: boolean;
  error: unknown;
}) {
  const can = useCan();
  const teams = useTeams();
  const events = useEvents();
  const people = usePeople({}, can("user.view"));
  const slot = defaultSlot();

  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    type: initial?.type ?? ("INTERNAL" as MeetingType),
    teamId: fixed?.teamId ?? initial?.team?.id ?? "",
    eventId: fixed?.eventId ?? initial?.event?.id ?? "",
    joinUrl: initial?.joinUrl ?? "",
    location: initial?.location ?? "",
    agenda: initial?.agenda ?? "",
    scheduledStart: initial?.scheduledStart ? toDateTimeInput(initial.scheduledStart) : slot.start,
    scheduledEnd: initial?.scheduledEnd ? toDateTimeInput(initial.scheduledEnd) : slot.end,
    participantIds: [] as string[],
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const toggle = (id: string) =>
    set({ participantIds: form.participantIds.includes(id) ? form.participantIds.filter((p) => p !== id) : [...form.participantIds, id] });

  return (
    <Dialog
      wide
      open={open}
      onClose={onClose}
      title={mode === "create" ? "New meeting" : "Edit meeting"}
      description={mode === "create" ? "TEAM OS keeps the record: participants, attendance, notes, decisions and actions." : undefined}
      submitLabel={mode === "create" ? "Create meeting" : "Save changes"}
      submitting={saving}
      error={error ? errorMessage(error) : null}
      onSubmit={() =>
        onSave({
          title: form.title,
          description: form.description || null,
          type: form.type,
          teamId: form.teamId || null,
          eventId: form.eventId || null,
          joinUrl: form.joinUrl || null,
          location: form.location || null,
          agenda: form.agenda || null,
          scheduledStart: new Date(form.scheduledStart).toISOString(),
          scheduledEnd: new Date(form.scheduledEnd).toISOString(),
          ...(mode === "create" ? { participantIds: form.participantIds } : {}),
        })
      }
    >
      <Field label="Meeting title" htmlFor="mt-title">
        <Input id="mt-title" required minLength={2} autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Creative sync — summit stage" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="mt-type">
          <Select id="mt-type" value={form.type} onChange={(e) => set({ type: e.target.value as MeetingType })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {meetingTypeLabel[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Meeting link"
          htmlFor="mt-url"
          hint="Paste your Google Meet link. People open it from here and TEAM OS records who joined."
        >
          <Input id="mt-url" type="url" value={form.joinUrl} onChange={(e) => set({ joinUrl: e.target.value })} placeholder="https://meet.google.com/abc-defg-hij" />
        </Field>
        <Field label="Starts" htmlFor="mt-start">
          <Input id="mt-start" type="datetime-local" required value={form.scheduledStart} onChange={(e) => set({ scheduledStart: e.target.value })} />
        </Field>
        <Field label="Ends" htmlFor="mt-end">
          <Input id="mt-end" type="datetime-local" required min={form.scheduledStart} value={form.scheduledEnd} onChange={(e) => set({ scheduledEnd: e.target.value })} />
        </Field>
        {!fixed?.teamId && (
          <Field label="Team" htmlFor="mt-team">
            <Select id="mt-team" value={form.teamId} onChange={(e) => set({ teamId: e.target.value })}>
              <option value="">No team</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!fixed?.eventId && (
          <Field label="Event" htmlFor="mt-event">
            <Select id="mt-event" value={form.eventId} onChange={(e) => set({ eventId: e.target.value })}>
              <option value="">No event</option>
              {events.data?.map((e2) => (
                <option key={e2.id} value={e2.id}>
                  {e2.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Place" htmlFor="mt-location" hint="For physical meetings.">
          <Input id="mt-location" value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Conference room / venue" />
        </Field>
      </div>

      <Field label="Agenda" htmlFor="mt-agenda">
        <Textarea id="mt-agenda" value={form.agenda} onChange={(e) => set({ agenda: e.target.value })} placeholder="Points to cover, one per line" />
      </Field>

      {mode === "create" && people.data && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Participants</legend>
          <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
            {people.data
              .filter((p) => p.status !== "DISABLED")
              .map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft">
                  <input type="checkbox" className="size-4 accent-brand" checked={form.participantIds.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="truncate">{p.name}</span>
                </label>
              ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">You are added as host automatically.</p>
        </fieldset>
      )}
    </Dialog>
  );
}

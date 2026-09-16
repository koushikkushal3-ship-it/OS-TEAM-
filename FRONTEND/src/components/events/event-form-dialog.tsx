"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import type { EventInput } from "@/features/events/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { EventStatus } from "@/lib/api/types";
import { titleCase, toDateInput } from "@/lib/format";

const STATUSES: EventStatus[] = ["PLANNING", "ACTIVE", "COMPLETED", "ARCHIVED"];

export function EventFormDialog({
  mode,
  open,
  initial,
  onClose,
  onSave,
  saving,
  error,
}: {
  mode: "create" | "edit";
  open: boolean;
  initial?: Omit<Partial<EventInput>, "budget"> & { budget?: string | number | null };
  onClose: () => void;
  onSave: (input: EventInput) => void;
  saving: boolean;
  error: unknown;
}) {
  const teams = useTeams();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    venue: initial?.venue ?? "",
    startDate: toDateInput(initial?.startDate),
    endDate: toDateInput(initial?.endDate),
    budget: initial?.budget != null ? String(initial.budget) : "",
    status: initial?.status ?? ("PLANNING" as EventStatus),
    teamIds: [] as string[],
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const toggleTeam = (id: string) =>
    set({ teamIds: form.teamIds.includes(id) ? form.teamIds.filter((t) => t !== id) : [...form.teamIds, id] });

  return (
    <Dialog
      wide
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Create event" : "Edit event"}
      description={mode === "create" ? "Selected teams get a workspace for this event automatically." : undefined}
      submitLabel={mode === "create" ? "Create event" : "Save changes"}
      submitting={saving}
      error={error ? errorMessage(error) : null}
      onSubmit={() =>
        onSave({
          name: form.name,
          description: form.description || null,
          venue: form.venue || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          budget: form.budget === "" ? null : Number(form.budget),
          ...(mode === "edit" ? { status: form.status } : { teamIds: form.teamIds }),
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Event name" htmlFor="ev-name">
            <Input id="ev-name" required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. India Summit 2026" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="ev-desc">
            <Textarea id="ev-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
        <Field label="Start date" htmlFor="ev-start">
          <Input id="ev-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="End date" htmlFor="ev-end">
          <Input id="ev-end" type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
        <Field label="Venue" htmlFor="ev-venue">
          <Input id="ev-venue" value={form.venue} onChange={(e) => set({ venue: e.target.value })} />
        </Field>
        <Field label="Budget (₹)" htmlFor="ev-budget" hint="Visible only to people who can edit the event or view finance.">
          <Input id="ev-budget" type="number" min={0} step="1" value={form.budget} onChange={(e) => set({ budget: e.target.value })} />
        </Field>
        {mode === "edit" && (
          <Field label="Status" htmlFor="ev-status">
            <Select id="ev-status" value={form.status} onChange={(e) => set({ status: e.target.value as EventStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {mode === "create" && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Teams working on this event</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {teams.data
              ?.filter((t) => t.isActive)
              .map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft"
                >
                  <input type="checkbox" className="size-4 accent-brand" checked={form.teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
          </div>
        </fieldset>
      )}
    </Dialog>
  );
}

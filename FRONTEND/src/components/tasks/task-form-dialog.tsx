"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import { usePeople } from "@/features/people/api";
import type { TaskInput } from "@/features/tasks/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { TaskDetail, TaskPriority, TaskStatus } from "@/lib/api/types";
import { taskStatusLabel, titleCase, toDateInput } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES: TaskStatus[] = ["BACKLOG", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED", "CANCELLED"];

export function TaskFormDialog({
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
  initial?: Partial<TaskDetail>;
  /** Pre-set context, e.g. creating from a team or event page. */
  fixed?: { teamId?: string; eventId?: string };
  onClose: () => void;
  onSave: (input: TaskInput) => void;
  saving: boolean;
  error: unknown;
}) {
  const can = useCan();
  const teams = useTeams();
  const events = useEvents();
  const people = usePeople({}, can("user.view"));
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    teamId: fixed?.teamId ?? initial?.team?.id ?? "",
    eventId: fixed?.eventId ?? initial?.event?.id ?? "",
    assignedToId: initial?.assignedTo?.id ?? "",
    priority: initial?.priority ?? ("MEDIUM" as TaskPriority),
    status: initial?.status ?? ("BACKLOG" as TaskStatus),
    startDate: toDateInput(initial?.startDate),
    dueDate: toDateInput(initial?.dueDate),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      wide
      open={open}
      onClose={onClose}
      title={mode === "create" ? "New task" : "Edit task"}
      description={mode === "create" ? "Assign work to a person, inside a team or event." : undefined}
      submitLabel={mode === "create" ? "Create task" : "Save changes"}
      submitting={saving}
      error={error ? errorMessage(error) : null}
      onSubmit={() =>
        onSave({
          title: form.title,
          description: form.description || null,
          teamId: form.teamId || null,
          eventId: form.eventId || null,
          assignedToId: form.assignedToId || null,
          priority: form.priority,
          startDate: form.startDate || null,
          dueDate: form.dueDate || null,
          ...(mode === "edit" ? { status: form.status } : {}),
        })
      }
    >
      <Field label="Task" htmlFor="task-title">
        <Input id="task-title" required minLength={2} autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Design the summit stage backdrop" />
      </Field>
      <Field label="Details" htmlFor="task-desc">
        <Textarea id="task-desc" value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="What done looks like, links, constraints" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {!fixed?.teamId && (
          <Field label="Team" htmlFor="task-team">
            <Select id="task-team" value={form.teamId} onChange={(e) => set({ teamId: e.target.value })}>
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
          <Field label="Event" htmlFor="task-event">
            <Select id="task-event" value={form.eventId} onChange={(e) => set({ eventId: e.target.value })}>
              <option value="">No event</option>
              {events.data?.map((e2) => (
                <option key={e2.id} value={e2.id}>
                  {e2.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Assign to" htmlFor="task-assignee">
          <Select id="task-assignee" value={form.assignedToId} onChange={(e) => set({ assignedToId: e.target.value })}>
            <option value="">Unassigned</option>
            {people.data
              ?.filter((p) => p.status !== "DISABLED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <Select id="task-priority" value={form.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="task-start">
          <Input id="task-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="Due date" htmlFor="task-due">
          <Input id="task-due" type="date" min={form.startDate || undefined} value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </Field>
        {mode === "edit" && (
          <Field label="Status" htmlFor="task-status">
            <Select id="task-status" value={form.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {taskStatusLabel[s]}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

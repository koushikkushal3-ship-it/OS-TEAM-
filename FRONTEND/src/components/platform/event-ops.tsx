"use client";

import clsx from "clsx";
import { CheckCircle2, Circle, Copy, Plus, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Select, Spinner } from "@/components/ui/primitives";
import { usePeople } from "@/features/people/api";
import { type Shift, useBudgetHealth, useDuplicateEvent, useEventShifts, useRunActions, useRunOfShow, useShiftActions } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";
import { formatDateTime, formatMoney, formatTime, toDateInput, toDateTimeInput } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const iso = (local: string) => (local ? new Date(local).toISOString() : "");

function PersonPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const can = useCan();
  const people = usePeople({ status: "ACTIVE" }, can("user.view"));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Nobody</option>
      {people.data?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

// ── Shifts ───────────────────────────────────────────────────────────────────

function ShiftDialog({ eventId, shift, onClose }: { eventId: string; shift?: Shift; onClose: () => void }) {
  const { save } = useShiftActions(eventId);
  const [form, setForm] = useState({
    title: shift?.title ?? "",
    location: shift?.location ?? "",
    startsAt: toDateTimeInput(shift?.startsAt),
    endsAt: toDateTimeInput(shift?.endsAt),
    capacity: shift?.capacity ?? 2,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={shift ? `Edit shift · ${shift.title}` : "Add a shift"}
      submitLabel={shift ? "Save" : "Add shift"}
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() => save.mutate({ id: shift?.id, ...form, location: form.location || null, startsAt: iso(form.startsAt), endsAt: iso(form.endsAt), capacity: Number(form.capacity) }, { onSuccess: onClose })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What" htmlFor="sh-title">
          <Input id="sh-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Registration desk" />
        </Field>
        <Field label="Where" htmlFor="sh-loc">
          <Input id="sh-loc" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Gate 2" />
        </Field>
        <Field label="Starts" htmlFor="sh-start">
          <Input id="sh-start" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
        </Field>
        <Field label="Ends" htmlFor="sh-end">
          <Input id="sh-end" type="datetime-local" required value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
        </Field>
        <Field label="People needed" htmlFor="sh-cap">
          <Input id="sh-cap" type="number" min={1} max={500} required value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))} />
        </Field>
      </div>
    </Dialog>
  );
}

export function ShiftsSection({ eventId }: { eventId: string }) {
  const { data, isLoading, error } = useEventShifts(eventId);
  const actions = useShiftActions(eventId);
  const { data: me } = useMe();
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  const [assigning, setAssigning] = useState<Shift | null>(null);
  const [assignee, setAssignee] = useState("");
  // No shift.view for this event: the section simply is not shown.
  if (error) return null;
  const caps = data?.capabilities;
  const mutationError = actions.signup.error ?? actions.assign.error ?? actions.remove.error;

  return (
    <Card className="mt-6">
      <CardHeader
        title="Shifts"
        description="Who is where, and when, on the day"
        action={
          caps?.canManage && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" /> Add shift
            </Button>
          )
        }
      />
      {mutationError && (
        <div className="px-5 pb-3">
          <ErrorNote>{errorMessage(mutationError)}</ErrorNote>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : !data?.shifts.length ? (
        <EmptyState title="No shifts yet" />
      ) : (
        <ul className="divide-y divide-line">
          {data.shifts.map((s) => {
            const joined = s.assignments.some((a) => a.userId === me?.user.id);
            const full = s.assignments.length >= s.capacity;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-48 flex-1">
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-ink-soft">
                    {formatDateTime(s.startsAt)} – {formatTime(s.endsAt)}
                    {s.location && ` · ${s.location}`}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.assignments.map((a) => (
                      <span key={a.userId} className="inline-flex items-center gap-1 rounded-full border border-line py-0.5 pr-2 pl-0.5 text-xs">
                        <Avatar name={a.user.name} src={a.user.avatarUrl} size={18} /> {a.user.name}
                        {caps?.canManage && (
                          <button aria-label={`Remove ${a.user.name}`} className="text-ink-faint hover:text-danger" onClick={() => actions.assign.mutate({ id: s.id, userId: a.userId, add: false })}>
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                <Badge tone={full ? "ok" : "warn"}>
                  {s.assignments.length}/{s.capacity}
                </Badge>
                {caps?.canSignup && (joined ? (
                  <Button size="sm" variant="ghost" onClick={() => actions.signup.mutate({ id: s.id, join: false })}>
                    Leave
                  </Button>
                ) : (
                  !full && (
                    <Button size="sm" variant="secondary" onClick={() => actions.signup.mutate({ id: s.id, join: true })}>
                      Sign up
                    </Button>
                  )
                ))}
                {caps?.canManage && (
                  <>
                    {!full && (
                      <Button size="sm" variant="ghost" aria-label="Assign someone" onClick={() => setAssigning(s)}>
                        <UserPlus className="size-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Delete shift" onClick={() => confirm(`Delete ${s.title}?`) && actions.remove.mutate(s.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <ShiftDialog eventId={eventId} shift={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {assigning && (
        <Dialog
          open
          onClose={() => setAssigning(null)}
          title={`Assign to ${assigning.title}`}
          description="They are notified. Someone already on an overlapping shift cannot be added."
          submitLabel="Assign"
          submitting={actions.assign.isPending}
          error={actions.assign.error ? errorMessage(actions.assign.error) : null}
          onSubmit={() => actions.assign.mutate({ id: assigning.id, userId: assignee, add: true }, { onSuccess: () => setAssigning(null) })}
        >
          <Field label="Person" htmlFor="sh-assignee">
            <PersonPicker id="sh-assignee" value={assignee} onChange={setAssignee} />
          </Field>
        </Dialog>
      )}
    </Card>
  );
}

// ── Run of show ──────────────────────────────────────────────────────────────

export function RunOfShowSection({ eventId }: { eventId: string }) {
  const { data, isLoading } = useRunOfShow(eventId);
  const { add, toggle, remove } = useRunActions(eventId);
  const { data: me } = useMe();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", startsAt: "", endsAt: "", ownerId: "" });
  const canManage = data?.capabilities.canManage;

  return (
    <Card className="mt-6">
      <CardHeader
        title="Run of show"
        description="The minute-by-minute plan. Owners tick their line off on the day."
        action={
          canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add line
            </Button>
          )
        }
      />
      {(toggle.error ?? remove.error) && (
        <div className="px-5 pb-3">
          <ErrorNote>{errorMessage(toggle.error ?? remove.error)}</ErrorNote>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState title="No run of show yet" />
      ) : (
        <ol className="divide-y divide-line">
          {data.items.map((r) => {
            const mayTick = canManage || r.owner?.id === me?.user.id;
            return (
              <li key={r.id} className={clsx("flex items-center gap-3 px-5 py-2.5", r.doneAt && "opacity-60")}>
                <button disabled={!mayTick} onClick={() => toggle.mutate({ id: r.id, done: !r.doneAt })} aria-label={r.doneAt ? "Mark not done" : "Mark done"} className="text-ink-faint enabled:hover:text-brand disabled:cursor-default">
                  {r.doneAt ? <CheckCircle2 className="size-5 text-ok" /> : <Circle className="size-5" />}
                </button>
                <span className="w-24 font-mono text-xs text-ink-soft">
                  {formatTime(r.startsAt)}
                  {r.endsAt && `–${formatTime(r.endsAt)}`}
                </span>
                <span className={clsx("flex-1 text-sm", r.doneAt && "line-through")}>{r.title}</span>
                {r.owner && (
                  <span className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <Avatar name={r.owner.name} src={r.owner.avatarUrl} size={20} /> {r.owner.name}
                  </span>
                )}
                {canManage && (
                  <Button size="sm" variant="ghost" aria-label="Delete line" onClick={() => remove.mutate(r.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {adding && (
        <Dialog
          open
          onClose={() => setAdding(false)}
          title="Add to run of show"
          submitLabel="Add"
          submitting={add.isPending}
          error={add.error ? errorMessage(add.error) : null}
          onSubmit={() =>
            add.mutate(
              { title: form.title, startsAt: iso(form.startsAt), endsAt: form.endsAt ? iso(form.endsAt) : null, ownerId: form.ownerId || null },
              {
                onSuccess: () => {
                  setAdding(false);
                  setForm({ title: "", startsAt: "", endsAt: "", ownerId: "" });
                },
              },
            )
          }
        >
          <Field label="What happens" htmlFor="ro-title">
            <Input id="ro-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Chief guest arrives" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor="ro-start">
              <Input id="ro-start" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
            </Field>
            <Field label="Ends (optional)" htmlFor="ro-end">
              <Input id="ro-end" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Owner" htmlFor="ro-owner">
            <PersonPicker id="ro-owner" value={form.ownerId} onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))} />
          </Field>
        </Dialog>
      )}
    </Card>
  );
}

// ── Budget health ────────────────────────────────────────────────────────────

export function BudgetHealthSection({ eventId }: { eventId?: string }) {
  const can = useCan();
  const { data } = useBudgetHealth(eventId, can("finance.view"));
  if (!data?.length) return null;
  return (
    <Card className="mt-6">
      <CardHeader title="Budget health" description="Approved and reimbursed spending against each budget. Warns at 80%." />
      <ul className="divide-y divide-line">
        {data.map((b) => (
          <li key={b.id} className="px-5 py-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{b.name}</span>
              {!eventId && b.event && <span className="text-xs text-ink-faint">{b.event.name}</span>}
              <Badge tone={b.state === "over" ? "danger" : b.state === "warning" ? "warn" : "ok"}>{b.percent}%</Badge>
              <span className="ml-auto text-xs text-ink-soft">
                {formatMoney(b.spent)} of {formatMoney(b.amount)}
                {b.pending > 0 && ` · ${formatMoney(b.pending)} waiting for approval`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <div className={clsx("h-full rounded-full", b.state === "over" ? "bg-danger" : b.state === "warning" ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, b.percent)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Copy event (template) ────────────────────────────────────────────────────

export function DuplicateEventButton({ eventId, name, startDate }: { eventId: string; name: string; startDate: string | null }) {
  const duplicate = useDuplicateEvent(eventId);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: `${name} (copy)`, startDate: toDateInput(startDate), copyTasks: true, copyBudgets: true, copyShifts: true, copyRunOfShow: true });
  const toggles = [
    ["copyTasks", "Tasks (reset to backlog, unassigned)"],
    ["copyBudgets", "Budget lines (no expenses)"],
    ["copyShifts", "Shifts (nobody signed up)"],
    ["copyRunOfShow", "Run of show"],
  ] as const;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Copy className="size-4" /> Use as template
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Start a new event from this one"
          description="Teams come along. Every date moves by the same amount as the new start date. Money spent and attendance are never copied."
          submitLabel="Create event"
          submitting={duplicate.isPending}
          error={duplicate.error ? errorMessage(duplicate.error) : null}
          onSubmit={() =>
            duplicate.mutate({ ...form, startDate: form.startDate ? new Date(form.startDate).toISOString() : null }, { onSuccess: (e) => router.push(`/events/${e.id}`) })
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New event name" htmlFor="dup-name">
              <Input id="dup-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="New start date" htmlFor="dup-start">
              <Input id="dup-start" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
          </div>
          <div className="space-y-2">
            {toggles.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-brand" checked={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

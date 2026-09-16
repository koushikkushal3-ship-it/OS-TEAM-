"use client";

import { MessageSquare, Plus, Ticket as TicketIcon } from "lucide-react";
import { useState } from "react";
import { FileAttachments } from "@/components/operations/file-attachments";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import { type TicketInput, useCommentTicket, useSaveTicket, useTicket, useTicketStats, useTickets } from "@/features/operations/api";
import { usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { TicketPriority, TicketStatus } from "@/lib/api/types";
import { formatDateTime, priorityTone, ticketStatusLabel, ticketStatusTone, titleCase } from "@/lib/format";
import { Can, useCan } from "@/lib/permissions/can";

const PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUSES: TicketStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "RESOLVED", "CLOSED"];
const TABS = [
  { id: "open", label: "Open" },
  { id: "mine", label: "Mine" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;

function NewTicketDialog({ onClose }: { onClose: () => void }) {
  const save = useSaveTicket();
  const teams = useTeams();
  const events = useEvents();
  const can = useCan();
  const people = usePeople({}, can("ticket.assign") && can("user.view"));
  const [form, setForm] = useState<TicketInput>({ title: "", description: "", priority: "MEDIUM", teamId: "", eventId: "", assigneeId: "" });
  const set = (patch: Partial<TicketInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      open
      onClose={onClose}
      title="Raise a ticket"
      description="Operational issues stay on the record instead of disappearing into chat."
      submitLabel="Raise ticket"
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            ...form,
            description: form.description || null,
            teamId: form.teamId || null,
            eventId: form.eventId || null,
            assigneeId: form.assigneeId || null,
          },
          { onSuccess: onClose },
        )
      }
    >
      <Field label="What is the problem" htmlFor="tk-title">
        <Input id="tk-title" required minLength={3} autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Projector in main hall not working" />
      </Field>
      <Field label="Details" htmlFor="tk-desc">
        <Textarea id="tk-desc" value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="What happens, what you already tried" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Priority" htmlFor="tk-priority">
          <Select id="tk-priority" value={form.priority} onChange={(e) => set({ priority: e.target.value as TicketPriority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="tk-team">
          <Select id="tk-team" value={form.teamId ?? ""} onChange={(e) => set({ teamId: e.target.value })}>
            <option value="">No team</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Event" htmlFor="tk-event">
          <Select id="tk-event" value={form.eventId ?? ""} onChange={(e) => set({ eventId: e.target.value })}>
            <option value="">No event</option>
            {events.data?.map((e2) => (
              <option key={e2.id} value={e2.id}>
                {e2.name}
              </option>
            ))}
          </Select>
        </Field>
        {people.data && (
          <Field label="Assign to" htmlFor="tk-assignee">
            <Select id="tk-assignee" value={form.assigneeId ?? ""} onChange={(e) => set({ assigneeId: e.target.value })}>
              <option value="">Unassigned</option>
              {people.data
                .filter((p) => p.status !== "DISABLED")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function TicketDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: ticket, isLoading } = useTicket(id);
  const save = useSaveTicket();
  const comment = useCommentTicket(id);
  const can = useCan();
  const people = usePeople({}, can("ticket.assign") && can("user.view"));
  const [message, setMessage] = useState("");
  const [resolution, setResolution] = useState("");

  if (isLoading || !ticket) {
    return (
      <Dialog open onClose={onClose} title="Ticket">
        <Spinner />
      </Dialog>
    );
  }

  const { canUpdate, canAssign } = ticket.capabilities;

  return (
    <Dialog wide open onClose={onClose} title={`#${ticket.number} · ${ticket.title}`} description={ticket.description ?? undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ticketStatusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Badge>
        <Badge tone={priorityTone[ticket.priority]}>{titleCase(ticket.priority)}</Badge>
        {ticket.team && <Badge>{ticket.team.name}</Badge>}
        {ticket.event && <Badge>{ticket.event.name}</Badge>}
        <span className="ml-auto text-xs text-ink-faint">Raised by {ticket.requester?.name ?? "someone"}</span>
      </div>

      {canUpdate && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="tk-status">
            <Select id="tk-status" value={ticket.status} onChange={(e) => save.mutate({ id, status: e.target.value as TicketStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ticketStatusLabel[s]}
                </option>
              ))}
            </Select>
          </Field>
          {canAssign && people.data && (
            <Field label="Assigned to" htmlFor="tk-assign">
              <Select id="tk-assign" value={ticket.assignee?.id ?? ""} onChange={(e) => save.mutate({ id, assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {people.data
                  .filter((p) => p.status !== "DISABLED")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          {["RESOLVED", "CLOSED"].includes(ticket.status) && (
            <div className="sm:col-span-2">
              <Field label="Resolution" htmlFor="tk-res">
                <Textarea id="tk-res" value={resolution || ticket.resolution || ""} onChange={(e) => setResolution(e.target.value)} onBlur={() => resolution && save.mutate({ id, resolution })} placeholder="How it was fixed" />
              </Field>
            </div>
          )}
        </div>
      )}
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}

      <FileAttachments entityType="ticket" entityId={id} title="Screenshots & files" kinds={["SCREENSHOT", "ATTACHMENT", "DOCUMENT"]} />

      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="text-[15px] font-semibold">Activity ({ticket.activity.length})</h3>
        <ul className="space-y-3">
          {ticket.activity.map((a) => (
            <li key={a.id} className="flex gap-3">
              {a.user ? <Avatar name={a.user.name} src={a.user.avatarUrl} size={26} /> : <MessageSquare className="size-4 text-ink-faint" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span className="font-medium text-ink">{a.user?.name ?? "System"}</span>
                  {a.kind !== "comment" && <Badge>{titleCase(a.kind)}</Badge>}
                  {formatDateTime(a.createdAt)}
                </div>
                <p className="mt-0.5 text-sm whitespace-pre-wrap">{a.message}</p>
              </div>
            </li>
          ))}
          {ticket.activity.length === 0 && <li className="text-[13px] text-ink-faint">Nothing yet.</li>}
        </ul>

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            comment.mutate(message, { onSuccess: () => setMessage("") });
          }}
        >
          <Input className="min-w-56 flex-1" required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a comment…" aria-label="Comment" />
          <Button type="submit" loading={comment.isPending}>
            Comment
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

export default function TicketsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const can = useCan();

  const filters = tab === "open" ? { open: true } : tab === "mine" ? { mine: true } : tab === "resolved" ? { status: "RESOLVED" as TicketStatus } : {};
  const tickets = useTickets(filters);
  const stats = useTicketStats({}, can("ticket.view"));

  return (
    <>
      <PageHeader
        eyebrow="04 · Operations"
        title="Tickets"
        description="Technical, creative and operational issues with an owner, a priority and a resolution."
        actions={
          <Can permission="ticket.create">
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Raise ticket
            </Button>
          </Can>
        }
      />

      {stats.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open" value={stats.data.open} icon={<TicketIcon className="size-4" />} />
          <Stat label="Blocked" value={stats.data.blocked} />
          <Stat label="Resolved" value={stats.data.resolved} />
          <Stat label="Total" value={stats.data.total} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Ticket filter">
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

      <Card>
        <CardHeader title="Tickets" />
        {tickets.isLoading ? (
          <Spinner />
        ) : !tickets.data?.length ? (
          <EmptyState icon={<TicketIcon className="size-6" />} title="No tickets here" />
        ) : (
          <ul className="divide-y divide-line">
            {tickets.data.map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpenId(t.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-subtle">
                  <span className="font-mono text-xs text-ink-faint">#{t.number}</span>
                  <div className="min-w-40 flex-1">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                      {t.team && <span>{t.team.name}</span>}
                      {t.event && <span>{t.event.name}</span>}
                      <span>{t._count.activity} updates</span>
                    </div>
                  </div>
                  <Badge tone={priorityTone[t.priority]}>{titleCase(t.priority)}</Badge>
                  <Badge tone={ticketStatusTone[t.status]}>{ticketStatusLabel[t.status]}</Badge>
                  {t.assignee ? <Avatar name={t.assignee.name} src={t.assignee.avatarUrl} size={26} /> : <span className="text-xs text-ink-faint">Unassigned</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <NewTicketDialog onClose={() => setCreating(false)} />}
      {openId && <TicketDialog key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

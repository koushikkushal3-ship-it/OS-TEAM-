"use client";

import { Handshake, Mail, Phone, Plus } from "lucide-react";
import { useState } from "react";
import { FileAttachments } from "@/components/operations/file-attachments";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import {
  type OpportunityInput,
  useAddOpportunityActivity,
  useOpportunities,
  useOpportunity,
  useOpportunityStats,
  useSaveOpportunity,
} from "@/features/operations/api";
import { usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { OpportunityStatus, OpportunityType } from "@/lib/api/types";
import { formatDate, formatDateTime, formatMoney, opportunityStatusLabel, opportunityStatusTone, opportunityTypeLabel, titleCase, toDateInput } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const STATUSES: OpportunityStatus[] = ["NEW", "UNDER_REVIEW", "CONTACTED", "NEGOTIATING", "CONFIRMED", "REJECTED", "CLOSED"];

/** Which permission lets someone add this kind of record. */
const MANAGE_PERMISSION: Record<OpportunityType, string> = {
  SPONSOR: "sponsor.manage",
  GUEST: "guest.manage",
  VENDOR: "vendor.manage",
  VENUE: "venue.manage",
  COLLABORATION: "invitation.manage",
  INVITATION: "invitation.manage",
  PARTNER: "invitation.manage",
};

function OpportunityDialog({ types, initialType, onClose }: { types: OpportunityType[]; initialType: OpportunityType; onClose: () => void }) {
  const save = useSaveOpportunity();
  const events = useEvents();
  const teams = useTeams();
  const can = useCan();
  const people = usePeople({}, can("user.view"));
  const [form, setForm] = useState<OpportunityInput>({
    type: initialType,
    name: "",
    organizationName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    description: "",
    value: null,
    eventId: "",
    teamId: "",
    ownerId: "",
    nextActionAt: "",
  });
  const set = (patch: Partial<OpportunityInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title={`New ${opportunityTypeLabel[form.type].toLowerCase()}`}
      description="Everyone the organization talks to gets a record: who, what stage, who owns it, what is next."
      submitLabel="Save record"
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            ...form,
            value: form.value ? Number(form.value) : null,
            eventId: form.eventId || null,
            teamId: form.teamId || null,
            ownerId: form.ownerId || null,
            nextActionAt: form.nextActionAt ? new Date(form.nextActionAt).toISOString() : null,
            organizationName: form.organizationName || null,
            contactName: form.contactName || null,
            contactEmail: form.contactEmail || null,
            contactPhone: form.contactPhone || null,
            description: form.description || null,
          },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="op-type">
          <Select id="op-type" value={form.type} onChange={(e) => set({ type: e.target.value as OpportunityType })}>
            {types.map((t) => (
              <option key={t} value={t}>
                {opportunityTypeLabel[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="op-name">
          <Input id="op-name" required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Person or company" />
        </Field>
        <Field label="Organization" htmlFor="op-org">
          <Input id="op-org" value={form.organizationName ?? ""} onChange={(e) => set({ organizationName: e.target.value })} />
        </Field>
        <Field label="Contact person" htmlFor="op-contact">
          <Input id="op-contact" value={form.contactName ?? ""} onChange={(e) => set({ contactName: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="op-email">
          <Input id="op-email" type="email" value={form.contactEmail ?? ""} onChange={(e) => set({ contactEmail: e.target.value })} />
        </Field>
        <Field label="Phone" htmlFor="op-phone">
          <Input id="op-phone" value={form.contactPhone ?? ""} onChange={(e) => set({ contactPhone: e.target.value })} />
        </Field>
        <Field label="Value (₹)" htmlFor="op-value" hint="Sponsorship amount, vendor quote, venue price.">
          <Input id="op-value" type="number" min={0} value={form.value ?? ""} onChange={(e) => set({ value: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Next action on" htmlFor="op-next">
          <Input id="op-next" type="date" value={toDateInput(form.nextActionAt)} onChange={(e) => set({ nextActionAt: e.target.value })} />
        </Field>
        <Field label="Event" htmlFor="op-event">
          <Select id="op-event" value={form.eventId ?? ""} onChange={(e) => set({ eventId: e.target.value })}>
            <option value="">No event</option>
            {events.data?.map((e2) => (
              <option key={e2.id} value={e2.id}>
                {e2.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="op-team">
          <Select id="op-team" value={form.teamId ?? ""} onChange={(e) => set({ teamId: e.target.value })}>
            <option value="">No team</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {people.data && (
          <Field label="Owner" htmlFor="op-owner" hint="Who is chasing this.">
            <Select id="op-owner" value={form.ownerId ?? ""} onChange={(e) => set({ ownerId: e.target.value })}>
              <option value="">Me</option>
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
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="op-desc">
            <Textarea id="op-desc" value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="What was offered, what they asked for" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: item, isLoading } = useOpportunity(id);
  const save = useSaveOpportunity();
  const addActivity = useAddOpportunityActivity(id);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"note" | "call" | "email" | "meeting">("note");

  if (isLoading || !item) {
    return (
      <Dialog open onClose={onClose} title="Record">
        <Spinner />
      </Dialog>
    );
  }

  return (
    <Dialog wide open onClose={onClose} title={item.name} description={item.organizationName ?? opportunityTypeLabel[item.type]}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{opportunityTypeLabel[item.type]}</Badge>
        <Badge tone={opportunityStatusTone[item.status]}>{opportunityStatusLabel[item.status]}</Badge>
        {item.event && <Badge>{item.event.name}</Badge>}
        {item.value && <span className="text-sm font-semibold tabular-nums">{formatMoney(item.value)}</span>}
        {item.owner && (
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
            <Avatar name={item.owner.name} src={item.owner.avatarUrl} size={22} /> {item.owner.name}
          </span>
        )}
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        {item.contactName && (
          <div>
            <div className="text-xs text-ink-faint">Contact</div>
            {item.contactName}
          </div>
        )}
        {item.contactEmail && (
          <div>
            <div className="text-xs text-ink-faint">Email</div>
            <a href={`mailto:${item.contactEmail}`} className="inline-flex items-center gap-1 text-brand hover:underline">
              <Mail className="size-3.5" /> {item.contactEmail}
            </a>
          </div>
        )}
        {item.contactPhone && (
          <div>
            <div className="text-xs text-ink-faint">Phone</div>
            <a href={`tel:${item.contactPhone}`} className="inline-flex items-center gap-1 text-brand hover:underline">
              <Phone className="size-3.5" /> {item.contactPhone}
            </a>
          </div>
        )}
      </div>

      {item.description && <p className="text-sm whitespace-pre-wrap text-ink-soft">{item.description}</p>}

      {item.capabilities.canManage && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Stage" htmlFor="op-status">
            <Select id="op-status" value={item.status} onChange={(e) => save.mutate({ id, status: e.target.value as OpportunityStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {opportunityStatusLabel[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next action on" htmlFor="op-next2">
            <Input
              id="op-next2"
              type="date"
              defaultValue={toDateInput(item.nextActionAt)}
              onChange={(e) => save.mutate({ id, nextActionAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          </Field>
        </div>
      )}
      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}

      <FileAttachments entityType="opportunity" entityId={id} title="Proposals & evidence" kinds={["PROPOSAL", "DOCUMENT", "SCREENSHOT", "ATTACHMENT"]} />

      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="text-[15px] font-semibold">Activity ({item.activity.length})</h3>
        <ul className="space-y-2">
          {item.activity.map((a) => (
            <li key={a.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <Badge>{titleCase(a.kind)}</Badge>
                <span className="font-medium text-ink">{a.user?.name ?? "System"}</span>
                {formatDateTime(a.createdAt)}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{a.message}</p>
            </li>
          ))}
          {item.activity.length === 0 && <li className="text-[13px] text-ink-faint">Nothing logged yet.</li>}
        </ul>

        {item.capabilities.canManage && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addActivity.mutate({ message, kind }, { onSuccess: () => setMessage("") });
            }}
          >
            <Select className="h-10 w-32" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Activity type">
              <option value="note">Note</option>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
            </Select>
            <Input className="min-w-48 flex-1" required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What happened…" aria-label="Activity" />
            <Button type="submit" loading={addActivity.isPending}>
              Log
            </Button>
          </form>
        )}
      </div>
    </Dialog>
  );
}

/** Shared board used by the Operations and Invitations pages. */
export function OpportunityBoard({
  eyebrow,
  title,
  description,
  types,
}: {
  eyebrow: string;
  title: string;
  description: string;
  types: OpportunityType[];
}) {
  const can = useCan();
  const [type, setType] = useState<OpportunityType | "ALL">("ALL");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useOpportunities(type === "ALL" ? {} : { type });
  const stats = useOpportunityStats();
  const visible = list.data?.filter((o) => types.includes(o.type)) ?? [];
  const canAdd = types.some((t) => can(MANAGE_PERMISSION[t]));

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          canAdd ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New record
            </Button>
          ) : undefined
        }
      />

      {stats.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Records" value={visible.length} icon={<Handshake className="size-4" />} />
          <Stat label="Confirmed" value={stats.data.byStatus.CONFIRMED ?? 0} hint={formatMoney(stats.data.confirmed.value)} />
          <Stat label="In conversation" value={(stats.data.byStatus.CONTACTED ?? 0) + (stats.data.byStatus.NEGOTIATING ?? 0)} />
          <Stat label="New" value={stats.data.byStatus.NEW ?? 0} />
        </div>
      )}

      {types.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Type filter">
          <button
            role="tab"
            aria-selected={type === "ALL"}
            onClick={() => setType("ALL")}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            All
          </button>
          {types.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={type === t}
              onClick={() => setType(t)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
            >
              {opportunityTypeLabel[t]}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="Pipeline" description="New → Contacted → Negotiating → Confirmed." />
        {list.isLoading ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <EmptyState icon={<Handshake className="size-6" />} title="Nothing here yet" description="Records you add or own appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((o) => (
              <li key={o.id}>
                <button onClick={() => setOpenId(o.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-subtle">
                  <div className="min-w-40 flex-1">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                      {o.organizationName && <span>{o.organizationName}</span>}
                      {o.event && <span>{o.event.name}</span>}
                      {o.nextActionAt && <span>Next: {formatDate(o.nextActionAt)}</span>}
                    </div>
                  </div>
                  {o.value && <span className="text-sm font-semibold tabular-nums">{formatMoney(o.value)}</span>}
                  <Badge>{opportunityTypeLabel[o.type]}</Badge>
                  <Badge tone={opportunityStatusTone[o.status]}>{opportunityStatusLabel[o.status]}</Badge>
                  {o.owner && <Avatar name={o.owner.name} src={o.owner.avatarUrl} size={26} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <OpportunityDialog types={types} initialType={types[0]} onClose={() => setCreating(false)} />}
      {openId && <DetailDialog key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

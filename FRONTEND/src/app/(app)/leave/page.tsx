"use client";

import { Plane, Plus } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { type LeaveRequest, type LeaveStatus, useLeave, useLeaveActions } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";
import { formatDate, formatDateRange } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const TONE: Record<LeaveStatus, "warn" | "ok" | "danger" | "neutral"> = { PENDING: "warn", APPROVED: "ok", REJECTED: "danger", CANCELLED: "neutral" };

function RequestDialog({ onClose }: { onClose: () => void }) {
  const { request } = useLeaveActions();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ type: "Leave", startDate: today, endDate: today, reason: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Request leave"
      description="Your team leads are notified and decide. Approved leave shows on the workload view and your calendar."
      submitLabel="Send request"
      submitting={request.isPending}
      error={request.error ? errorMessage(request.error) : null}
      onSubmit={() => request.mutate({ ...form, reason: form.reason || undefined }, { onSuccess: onClose })}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" htmlFor="lv-type">
          <Select id="lv-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {["Leave", "Sick", "Unavailable", "Exam", "Travel"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="lv-from">
          <Input id="lv-from" type="date" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
        </Field>
        <Field label="To" htmlFor="lv-to">
          <Input id="lv-to" type="date" required min={form.startDate} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
        </Field>
      </div>
      <Field label="Reason (optional)" htmlFor="lv-reason">
        <Textarea id="lv-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
      </Field>
    </Dialog>
  );
}

function LeaveList({ rows, reviewing, meId }: { rows: LeaveRequest[]; reviewing: boolean; meId: string }) {
  const { review, cancel } = useLeaveActions();
  const error = review.error ?? cancel.error;
  if (!rows.length) return <EmptyState icon={<Plane className="size-6" />} title="No leave requests" />;
  return (
    <>
      {error && (
        <div className="px-5 pt-3">
          <ErrorNote>{errorMessage(error)}</ErrorNote>
        </div>
      )}
      <ul className="divide-y divide-line">
        {rows.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            {reviewing && <Avatar name={l.user.name} src={l.user.avatarUrl} size={28} />}
            <div className="min-w-48 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {reviewing && <span>{l.user.name}</span>}
                <span>{l.type}</span>
                <Badge tone={TONE[l.status]}>{l.status.toLowerCase()}</Badge>
              </div>
              <div className="text-xs text-ink-soft">
                {formatDateRange(l.startDate, l.endDate)}
                {l.reason && ` · ${l.reason}`}
              </div>
              {l.reviewedBy && (
                <div className="text-xs text-ink-faint">
                  {l.status.toLowerCase()} by {l.reviewedBy.name} on {formatDate(l.reviewedAt)}
                  {l.reviewNote && ` — ${l.reviewNote}`}
                </div>
              )}
            </div>
            {reviewing && l.status === "PENDING" && l.user.id !== meId && (
              <>
                <Button size="sm" onClick={() => review.mutate({ id: l.id, decision: "APPROVE" })}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" onClick={() => review.mutate({ id: l.id, decision: "REJECT", note: prompt("Reason for rejecting (optional)") ?? undefined })}>
                  Reject
                </Button>
              </>
            )}
            {!reviewing && ["PENDING", "APPROVED"].includes(l.status) && (
              <Button size="sm" variant="ghost" onClick={() => confirm("Cancel this request?") && cancel.mutate(l.id)}>
                Cancel
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function LeavePage() {
  const can = useCan();
  const { data: me } = useMe();
  const isLead = !!me?.teams.some((t) => t.memberRole !== "MEMBER");
  const approver = can("leave.approve");
  type Scope = "mine" | "team" | "all";
  const tabs: { key: Scope; label: string }[] = [
    { key: "mine", label: "My requests" },
    ...(isLead ? [{ key: "team" as const, label: "My teams" }] : []),
    ...(approver ? [{ key: "all" as const, label: "Everyone" }] : []),
  ];
  const [tab, setTab] = useState<Scope>("mine");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useLeave(tab);

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="Leave & availability"
        description="Tell your leads when you are away, so work is planned around it."
        actions={
          can("leave.request") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Request leave
            </Button>
          )
        }
      />
      {tabs.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <Card>{isLoading || !me ? <Spinner /> : <LeaveList rows={data ?? []} reviewing={tab !== "mine" && approver} meId={me.user.id} />}</Card>
      {creating && <RequestDialog onClose={() => setCreating(false)} />}
    </>
  );
}

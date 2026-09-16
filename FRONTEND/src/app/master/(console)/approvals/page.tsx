"use client";

import { ShieldCheck } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { type ChangeRequest, useApprovals, useControl } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";

const TONE: Record<ChangeRequest["status"], "warn" | "ok" | "danger" | "neutral"> = { PENDING: "warn", EXECUTED: "ok", REJECTED: "danger", CANCELLED: "neutral" };

export default function ApprovalsPage() {
  const { data, isLoading } = useApprovals();
  const { decide } = useControl();

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Approvals"
        description="Two-person rule: making someone a Master Admin or deleting a module waits here until a different Master Admin approves. With only one Master Admin, changes go through directly."
      />
      {decide.error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(decide.error)}</ErrorNote>
        </div>
      )}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={<ShieldCheck className="size-6" />} title="No requests" />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-60 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.summary} <Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                  </div>
                  <div className="text-xs text-ink-soft">
                    Requested by {r.requestedBy?.name ?? "—"} · {formatDateTime(r.createdAt)}
                    {r.decidedBy && ` · decided by ${r.decidedBy.name} ${formatDateTime(r.decidedAt)}`}
                  </div>
                  {r.error && <div className="text-xs text-danger">{r.error}</div>}
                </div>
                {r.canDecide && (
                  <>
                    <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approve" })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: r.id, decision: "reject" })}>
                      Reject
                    </Button>
                  </>
                )}
                {r.canCancel && (
                  <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, decision: "cancel" })}>
                    Cancel request
                  </Button>
                )}
                {r.status === "PENDING" && !r.canDecide && !r.canCancel && <span className="text-xs text-ink-faint">Waiting for another Master Admin</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

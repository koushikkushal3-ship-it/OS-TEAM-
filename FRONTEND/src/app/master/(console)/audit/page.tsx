"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from "@/components/ui/primitives";
import { type AuditFilters, useAudit } from "@/features/administration/api";
import { describeAction, formatDateTime } from "@/lib/format";
import { useControl } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";

const ENTITY_TYPES = ["user", "role", "permission_override", "team", "event", "department", "module", "organization", "session", "system_setting"];

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>;
  return <pre className="max-h-60 overflow-auto rounded-md bg-subtle p-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink">{JSON.stringify(value, null, 2)}</pre>;
}

/** Changes whose old value fully describes the previous state; the server re-checks. */
const REVERTIBLE = new Set(["user.disabled", "user.enabled", "module.enabled", "module.disabled", "permission.access_changed", "permission.override_set", "permission.override_removed", "platform.maintenance_changed", "platform.branding_changed"]);

export default function AuditPage() {
  const control = useControl();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [cursors, setCursors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useAudit({ ...filters, cursor: cursors.at(-1) });

  const setFilter = (patch: AuditFilters) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([]);
  };

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Audit log" description="Who changed what, when — with the previous and new values." />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Action contains… e.g. permission" value={filters.action ?? ""} onChange={(e) => setFilter({ action: e.target.value || undefined })} aria-label="Filter by action" />
        <Select className="w-52" value={filters.entityType ?? ""} onChange={(e) => setFilter({ entityType: e.target.value || undefined })} aria-label="Filter by record type">
          <option value="">All record types</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {describeAction(t)}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-x-auto">
        {query.isLoading ? (
          <Spinner />
        ) : !query.data?.items.length ? (
          <EmptyState title="No audit entries match" />
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-subtle text-xs text-ink-soft">
              <tr>
                <th className="w-8" />
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Who</th>
                <th className="px-3 py-2.5 font-medium">Action</th>
                <th className="px-3 py-2.5 font-medium">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.data.items.map((a) => {
                const open = expanded === a.id;
                return (
                  <Fragment key={a.id}>
                    <tr className="cursor-pointer hover:bg-subtle" onClick={() => setExpanded(open ? null : a.id)}>
                      <td className="pl-3">
                        <ChevronRight className={`size-4 text-ink-faint transition-transform ${open ? "rotate-90" : ""}`} />
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap text-ink-soft">{formatDateTime(a.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{a.actor?.name ?? "System"}</div>
                        {a.ip && <div className="text-xs text-ink-faint">{a.ip}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="mr-2">{describeAction(a.action)}</span>
                        {a.privileged && <Badge tone="master">Privileged</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-soft">
                        {describeAction(a.entityType)}
                        {a.entityId && <code className="ml-1 font-mono text-[11px] text-ink-faint">{a.entityId.slice(0, 8)}</code>}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface">
                        <td />
                        <td colSpan={4} className="px-3 pb-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-xs font-medium text-ink-soft">Old value</div>
                              <Value value={a.oldValue} />
                            </div>
                            <div>
                              <div className="mb-1 text-xs font-medium text-ink-soft">New value</div>
                              <Value value={a.newValue} />
                            </div>
                          </div>
                          {REVERTIBLE.has(a.action) && (
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={control.revert.isPending && control.revert.variables === a.id}
                                onClick={() => confirm("Put back the old value? The undo is recorded in this log too.") && control.revert.mutate(a.id)}
                              >
                                Undo this change
                              </Button>
                              {control.revert.variables === a.id && control.revert.error && <span className="text-xs text-danger">{errorMessage(control.revert.error)}</span>}
                              {control.revert.variables === a.id && control.revert.isSuccess && <span className="text-xs text-ok">Undone.</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
          Newer
        </Button>
        <Button variant="secondary" size="sm" disabled={!query.data?.nextCursor} onClick={() => query.data?.nextCursor && setCursors((c) => [...c, query.data.nextCursor!])}>
          Older
        </Button>
      </div>
    </>
  );
}

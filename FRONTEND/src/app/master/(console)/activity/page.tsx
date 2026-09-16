"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Select, Spinner } from "@/components/ui/primitives";
import { useAlerts, useLogins } from "@/features/platform/api";
import { describeAction, formatDateTime } from "@/lib/format";

export default function ActivityPage() {
  const [days, setDays] = useState(7);
  const alerts = useAlerts(days);
  const logins = useLogins();

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Sign-ins & alerts"
        description="Worked out from the audit log: repeated failed gateway attempts, sign-ins from a new device, many file downloads in an hour, and new Master Admins."
        actions={
          <Select className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Alert window">
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </Select>
        }
      />

      <Card className="mb-6">
        <CardHeader title="Security alerts" />
        {alerts.isLoading ? (
          <Spinner />
        ) : !alerts.data?.length ? (
          <EmptyState icon={<ShieldCheck className="size-6" />} title="No alerts" description="Nothing unusual in this period." />
        ) : (
          <ul className="divide-y divide-line">
            {alerts.data.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <ShieldAlert className={a.severity === "high" ? "size-4 text-danger" : "size-4 text-warn"} />
                <Badge tone={a.severity === "high" ? "danger" : "warn"}>{a.severity}</Badge>
                <span className="font-medium">{a.actorName ?? "Unknown"}</span>
                <span className="flex-1 text-sm text-ink-soft">{a.message}</span>
                <span className="text-xs text-ink-faint">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader title="Signed in right now" description="Active sessions. Sign someone out everywhere from People." />
          {logins.isLoading ? (
            <Spinner />
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {logins.data?.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-2 font-medium">
                      {s.user.name}
                      {s.current && <Badge tone="brand" className="ml-2">this session</Badge>}
                      {s.impersonatorId && <Badge tone="master" className="ml-2">preview</Badge>}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{s.device}</td>
                    <td className="px-3 py-2 text-xs text-ink-faint">{s.ip ?? "—"}</td>
                    <td className="px-5 py-2 text-xs text-ink-faint">seen {formatDateTime(s.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card className="overflow-x-auto">
          <CardHeader title="Sign-in history" description="Last 30 days" />
          {logins.isLoading ? (
            <Spinner />
          ) : (
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {logins.data?.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2 font-medium">{e.actor?.name ?? "—"}</td>
                    <td className={e.action.endsWith("failed") ? "px-3 py-2 text-danger" : "px-3 py-2 text-ink-soft"}>{describeAction(e.action)}</td>
                    <td className="px-3 py-2 text-xs text-ink-faint">{e.device}</td>
                    <td className="px-5 py-2 text-xs text-ink-faint">{formatDateTime(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

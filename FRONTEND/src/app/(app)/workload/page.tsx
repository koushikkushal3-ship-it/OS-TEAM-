"use client";

import { Gauge } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Card, EmptyState, PageHeader, Select, Spinner } from "@/components/ui/primitives";
import { type WorkloadRow, useWorkload } from "@/features/platform/api";
import { useTeams } from "@/features/teams/api";
import { formatDateRange } from "@/lib/format";

const STATE: Record<WorkloadRow["state"], { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  light: { label: "Has room", tone: "ok" },
  busy: { label: "Busy", tone: "warn" },
  heavy: { label: "Overloaded", tone: "danger" },
  away: { label: "Away", tone: "neutral" },
};

export default function WorkloadPage() {
  const [teamId, setTeamId] = useState("");
  const teams = useTeams();
  const { data, isLoading } = useWorkload(teamId || undefined);

  return (
    <>
      <PageHeader
        eyebrow="02 · Teams & Events"
        title="Workload"
        description="Who is carrying how much before you assign more. Load = open tasks + open tickets + overdue tasks counted twice."
        actions={
          <Select className="w-52" value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Filter by team">
            <option value="">Everyone</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        }
      />
      <Card className="overflow-x-auto">
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={<Gauge className="size-6" />} title="No people to show" />
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-subtle text-xs text-ink-soft">
              <tr>
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Open tasks</th>
                <th className="px-3 py-2.5 font-medium">Overdue</th>
                <th className="px-3 py-2.5 font-medium">Due in 7 days</th>
                <th className="px-3 py-2.5 font-medium">Tickets</th>
                <th className="px-3 py-2.5 font-medium">Shifts (7 days)</th>
                <th className="px-5 py-2.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((r) => (
                <tr key={r.person.id}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.person.name} src={r.person.avatarUrl} size={28} />
                      <div>
                        <div className="font-medium">{r.person.name}</div>
                        <div className="text-xs text-ink-faint">{r.person.department?.name ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{r.openTasks}</td>
                  <td className={r.overdue ? "px-3 py-3 font-medium text-danger" : "px-3 py-3"}>{r.overdue}</td>
                  <td className="px-3 py-3">{r.dueThisWeek}</td>
                  <td className="px-3 py-3">{r.openTickets}</td>
                  <td className="px-3 py-3">{r.shiftsThisWeek}</td>
                  <td className="px-5 py-3">
                    <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                    {r.leave && <div className="mt-1 text-xs text-ink-faint">{r.leave.type}: {formatDateRange(r.leave.startDate, r.leave.endDate)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

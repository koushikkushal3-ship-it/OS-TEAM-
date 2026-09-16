"use client";

import { Blocks, CalendarRange, KeyRound, ScrollText, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Spinner, Stat } from "@/components/ui/primitives";
import { useMasterOverview } from "@/features/administration/api";
import { describeAction, formatDateTime } from "@/lib/format";

export default function MasterOverviewPage() {
  const { data, isLoading } = useMasterOverview();
  if (isLoading || !data) return <Spinner />;
  const { totals, modules, recentActivity } = data;

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Organization overview" description="Everything configured in TEAM OS, and what changed recently." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="People" value={totals.users} hint={`${totals.activeUsers} active`} icon={<Users className="size-4" />} />
        <Stat label="Teams" value={totals.teams} icon={<UsersRound className="size-4" />} />
        <Stat label="Events" value={totals.events} hint={`${totals.activeEvents} planning or active`} icon={<CalendarRange className="size-4" />} />
        <Stat label="Roles" value={totals.roles} icon={<KeyRound className="size-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Global activity"
            action={
              <Link href="/master/audit" className="text-[13px] font-medium text-brand hover:underline">
                Full audit log
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {recentActivity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <ScrollText className="size-4 shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{a.actor?.name ?? "System"}</span> <span className="text-ink-soft">· {describeAction(a.action)}</span>
                </span>
                {a.privileged && <Badge tone="master">Privileged</Badge>}
                <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Modules"
            action={
              <Link href="/master/modules" className="text-[13px] font-medium text-brand hover:underline">
                Manage
              </Link>
            }
          />
          <div className="space-y-3 p-5">
            {(["ENABLED", "PLANNED", "DISABLED"] as const).map((s) => (
              <div key={s} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-ink-soft">
                  <Blocks className="size-4 text-ink-faint" /> {s.charAt(0) + s.slice(1).toLowerCase()}
                </span>
                <span className="font-semibold tabular-nums">{modules[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

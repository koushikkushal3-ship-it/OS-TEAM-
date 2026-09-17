"use client";

import clsx from "clsx";
import { DatabaseBackup, HardDrive, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { Button, Card, CardHeader, ErrorNote, Input, PageHeader, Spinner, Switch } from "@/components/ui/primitives";
import { useBackups, useControl, useHealth } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";

const mb = (b: number | null | undefined) => (b == null ? "—" : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

function Meter({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  const pct = limit ? Math.round((used / limit) * 100) : null;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-soft">{label}</span>
        <span className="font-medium tabular-nums">{pct === null ? "no limit reported" : `${pct}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-subtle">
        <div className={clsx("h-full rounded-full", (pct ?? 0) >= 90 ? "bg-danger" : (pct ?? 0) >= 70 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
    </div>
  );
}

function Backups() {
  const { data } = useBackups();
  const control = useControl();
  if (!data) return <Spinner />;
  return (
    <Card>
      <CardHeader title="Backups" description="Every table except sessions and secrets, saved as a JSON file inside TEAM OS. Download it to keep a copy on your computer." action={<DatabaseBackup className="size-4 text-ink-faint" />} />
      <div className="space-y-3 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <Switch label="Scheduled backups" checked={data.enabled} onChange={(v) => control.backupSettings.mutate({ enabled: v, everyDays: data.everyDays })} />
          <span className="text-sm">Every</span>
          <Input className="w-20" type="number" min={1} max={60} defaultValue={data.everyDays} onBlur={(e) => control.backupSettings.mutate({ enabled: data.enabled, everyDays: Number(e.target.value) })} aria-label="Days between backups" />
          <span className="text-sm">days</span>
          <Button className="ml-auto" loading={control.runBackup.isPending} onClick={() => control.runBackup.mutate()}>
            Back up now
          </Button>
        </div>
        {(control.runBackup.error ?? control.backupSettings.error) && <ErrorNote>{errorMessage(control.runBackup.error ?? control.backupSettings.error)}</ErrorNote>}
        {data.lastError && <ErrorNote>Last attempt failed — {data.lastError}</ErrorNote>}
        <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
          {data.history.length === 0 && <li className="px-3 py-3 text-ink-faint">No backups yet.</li>}
          {data.history.map((h) => (
            <li key={h.at} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="font-medium">{formatDateTime(h.at)}</span>
              <span className="text-ink-soft">
                {h.tables} tables · {h.rows.toLocaleString("en-IN")} rows · {mb(h.bytes)}
              </span>
              <span className="text-xs text-ink-faint">{h.by}</span>
              {h.key ? (
                <a href={`/api/master/control/backups/download?key=${encodeURIComponent(h.key)}`} className="ml-auto text-brand hover:underline">
                  Download
                </a>
              ) : (
                h.url && <span className="ml-auto text-xs text-ink-faint">in the old Google Drive</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-faint">Restoring is a deliberate, manual job: the file holds everything needed, and TEAM OS never overwrites live data on its own.</p>
      </div>
    </Card>
  );
}

export default function HealthPage() {
  const { data, isLoading } = useHealth();
  if (isLoading || !data) return <Spinner />;
  const { database, people } = data;

  return (
    <>
      <PageHeader eyebrow="Master Control" title="System health" description="Free-plan limits, storage, backups and the switches that affect everyone." />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="size-4 text-ink-faint" /> Database
          </div>
          <div className="text-2xl font-semibold">{mb(database.bytes)}</div>
          <Meter used={database.bytes} limit={database.limitBytes} label="of Supabase free 500 MB" />
        </Card>
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4 text-ink-faint" /> People who can sign in
          </div>
          <div className="text-2xl font-semibold">
            {people.signInCapable} <span className="text-sm font-normal text-ink-soft">({people.active} active, {people.invited} invited)</span>
          </div>
          
        </Card>
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="size-4 text-ink-faint" /> File storage
          </div>
          <div className="text-2xl font-semibold">{data.storage.provider === "supabase" ? "Supabase Storage" : "Database"}</div>
          <p className="text-sm text-ink-soft">
            {data.storage.provider === "supabase"
              ? "Uploads and backups go to a private Supabase bucket (1 GB free)."
              : `Uploads and backups are kept in the database, up to ${data.storage.fileLimitMb} MB per file. Add Supabase Storage keys for bigger files.`}
          </p>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Link href="/master/approvals">
          <Card className="p-4 hover:bg-subtle">
            <div className="text-xs text-ink-faint">Waiting for approval</div>
            <div className="text-xl font-semibold">{data.pendingApprovals}</div>
          </Card>
        </Link>
        <Link href="/master/recycle-bin">
          <Card className="p-4 hover:bg-subtle">
            <div className="text-xs text-ink-faint">In the recycle bin</div>
            <div className="text-xl font-semibold">{data.recycleBin}</div>
          </Card>
        </Link>
        <Link href="/master/automations">
          <Card className="p-4 hover:bg-subtle">
            <div className="text-xs text-ink-faint">Automations on</div>
            <div className="text-xl font-semibold">
              {data.automation.enabled}/{data.automation.rules}
            </div>
            <div className="text-xs text-ink-faint">last run {formatDateTime(data.automation.lastRunAt)}</div>
          </Card>
        </Link>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Wrench className="size-4 text-ink-faint" /> Maintenance mode
          </div>
          <p className="mb-3 text-sm text-ink-soft">{data.maintenance.enabled ? "ON — the whole portal is closed." : "Off for the whole portal."}</p>
          <Link href="/master/maintenance" className="text-sm font-medium text-brand hover:underline">
            Open maintenance controls
          </Link>
        </Card>
        <Backups />
      </div>

      <Card className="overflow-x-auto">
        <CardHeader title="Largest tables" />
        <table className="w-full text-left text-[13px]">
          <tbody className="divide-y divide-line">
            {database.tables.map((t) => (
              <tr key={t.name}>
                <td className="px-5 py-2 font-mono">{t.name}</td>
                <td className="px-3 py-2 text-ink-soft">{t.rows.toLocaleString("en-IN")} rows</td>
                <td className="px-5 py-2 text-ink-soft">{mb(t.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

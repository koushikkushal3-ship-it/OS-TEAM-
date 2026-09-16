"use client";

import clsx from "clsx";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { useBin, useControl } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { formatDate, formatDateTime } from "@/lib/format";

const KIND: Record<string, string> = {
  task: "Task",
  expense: "Expense",
  budget: "Budget",
  ticket: "Ticket",
  idea: "Idea",
  opportunity: "Sponsor / vendor / guest",
  meeting: "Meeting",
  custom_record: "Custom record",
  event: "Event",
  team: "Team",
  file: "File",
  shift: "Shift",
  run_item: "Run of show line",
  schedule_entry: "Schedule entry",
};

export default function RecycleBinPage() {
  const [view, setView] = useState<"review" | "ignored">("review");
  const [now] = useState(() => Date.now());
  const { data, isLoading } = useBin(view);
  const { restore, ignore, purge } = useControl();
  const error = restore.error ?? ignore.error ?? purge.error;
  const busy = (m: { isPending: boolean; variables?: unknown }, id: string) => m.isPending && m.variables === id;

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Recycle bin"
        description="When anyone deletes something in their portal it disappears for them at once and lands here. Restore it, ignore it (accept the deletion), or delete it permanently. Anything left is removed for good after 30 days."
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Recycle bin view">
        {(
          [
            ["review", "Needs review", data?.counts.review],
            ["ignored", "Ignored", data?.counts.ignored],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {label}
            {count ? <span className="ml-1.5 font-semibold">{count}</span> : null}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(error)}</ErrorNote>
        </div>
      )}

      <Card>
        {isLoading || !data ? (
          <Spinner />
        ) : !data.items.length ? (
          <EmptyState icon={<Trash2 className="size-6" />} title={view === "review" ? "Nothing waiting for review" : "Nothing ignored"} />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                {item.deletedBy ? <Avatar name={item.deletedBy.name} size={32} /> : <span className="size-8" />}
                <div className="min-w-60 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <strong>{item.deletedBy?.name ?? "Someone"}</strong>
                    <span className="text-ink-soft">deleted</span>
                    <Badge>{KIND[item.entityType] ?? item.entityType}</Badge>
                    <strong className="truncate">{item.label}</strong>
                  </div>
                  <div className="text-xs text-ink-soft">
                    {formatDateTime(item.deletedAt)}
                    {item.deletedBy?.email && ` · ${item.deletedBy.email}`}
                    {" · "}
                    <span className={clsx(new Date(item.purgeAt).getTime() - now < 3 * 86_400_000 && "text-danger")}>removed for good after {formatDate(item.purgeAt)}</span>
                  </div>
                  {item.reviewedBy && (
                    <div className="text-xs text-ink-faint">
                      Ignored by {item.reviewedBy.name} on {formatDateTime(item.reviewedAt)}
                    </div>
                  )}
                </div>
                <Button size="sm" loading={busy(restore, item.id)} onClick={() => restore.mutate(item.id)}>
                  <RotateCcw className="size-3.5" /> Restore
                </Button>
                {view === "review" && (
                  <Button size="sm" variant="secondary" loading={busy(ignore, item.id)} onClick={() => ignore.mutate(item.id)}>
                    <EyeOff className="size-3.5" /> Ignore
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy(purge, item.id)}
                  onClick={() => confirm(`Delete "${item.label}" permanently? This cannot be undone${item.entityType === "file" ? ", and the file is removed from Google Drive too" : ""}.`) && purge.mutate(item.id)}
                >
                  <Trash2 className="size-3.5" /> Delete permanently
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-faint">Restore brings back the item together with what was deleted along with it (team members, meeting attendance, task updates, shift sign-ups, event budgets).</p>
    </>
  );
}

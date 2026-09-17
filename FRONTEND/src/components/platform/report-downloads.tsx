"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Save } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Select } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

type Kind = "people" | "weekly";

const KIND_LABEL: Record<string, string> = { weekly: "Weekly report", people: "People performance" };

/** Downloads a fresh report as Excel or CSV. Anyone can import the file into Google Sheets themselves. */
export function ReportDownloadButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("weekly");
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="size-4" /> Excel / CSV
      </Button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title="Download a report" description="Excel opens straight away. To use Google Sheets: sheets.google.com → Blank → File → Import → Upload.">
          <Field label="Report" htmlFor="dl-kind">
            <Select id="dl-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="weekly">Weekly report — last 7 days per person</option>
              <option value="people">People performance — scores and signals</option>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/reports/export?kind=${kind}&format=xlsx`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong">
              <Download className="size-4" /> Excel (.xlsx)
            </a>
            <a href={`/api/reports/export?kind=${kind}&format=csv`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-subtle">
              <Download className="size-4" /> CSV
            </a>
          </div>
        </Dialog>
      )}
    </>
  );
}

interface SavedReport {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  people: number;
}

/** Weekly reports kept in the portal by the automation, plus any saved by hand. */
export function SavedReports() {
  const can = useCan();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["reports", "saved"], queryFn: () => api<SavedReport[]>("/reports/saved") });
  const saveNow = useMutation({
    mutationFn: (kind: Kind) => api("/reports/saved", { method: "POST", body: { kind } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reports", "saved"] }),
  });

  return (
    <Card className="mt-6">
      <CardHeader
        title="Saved reports"
        description="The weekly report is saved here automatically every 7 days. Download any of them as Excel or CSV."
        action={
          can("report.export") && (
            <Button size="sm" variant="secondary" loading={saveNow.isPending} onClick={() => saveNow.mutate("weekly")}>
              <Save className="size-3.5" /> Save this week now
            </Button>
          )
        }
      />
      {saveNow.error && (
        <div className="px-5 pb-3">
          <ErrorNote>{errorMessage(saveNow.error)}</ErrorNote>
        </div>
      )}
      {!saved.data?.length ? (
        <EmptyState title="No saved reports yet" />
      ) : (
        <ul className="divide-y divide-line">
          {saved.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <Badge>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
              <div className="min-w-40 flex-1">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-ink-faint">
                  {formatDateTime(r.createdAt)} · {r.people} {r.people === 1 ? "row" : "rows"}
                </div>
              </div>
              <a href={`/api/reports/saved/${r.id}/download?format=xlsx`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] hover:bg-subtle">
                <Download className="size-3.5" /> Excel
              </a>
              <a href={`/api/reports/saved/${r.id}/download?format=csv`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] hover:bg-subtle">
                <Download className="size-3.5" /> CSV
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

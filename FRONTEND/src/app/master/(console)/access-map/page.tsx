"use client";

import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { Badge, Card, Input, PageHeader, Spinner } from "@/components/ui/primitives";
import { useAccessMap } from "@/features/platform/api";
import { formatDateTime } from "@/lib/format";

const PERSONAL: Record<string, { label: string; tone: "danger" | "ok" | "brand" | "warn" }> = {
  DENIED: { label: "hidden", tone: "danger" },
  FULL: { label: "full", tone: "ok" },
  VIEW_ONLY: { label: "view", tone: "brand" },
  CUSTOM: { label: "custom", tone: "warn" },
};

export default function AccessMapPage() {
  const { data, isLoading } = useAccessMap();
  const [filter, setFilter] = useState("");
  const rows = data?.rows.filter((r) => `${r.person.name} ${r.person.email} ${r.person.department?.name ?? ""}`.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Access map"
        description="Every person against every module: a tick means it is in their menu. Badges mark a personal exception set for that one person."
      />
      <Input className="mb-4 max-w-sm" placeholder="Filter by name, email or department" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter people" />
      <Card className="overflow-x-auto">
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-subtle text-xs text-ink-soft">
              <tr>
                <th className="sticky left-0 bg-subtle px-4 py-2.5 font-medium">Person</th>
                {data.modules.map((m) => (
                  <th key={m.key} className="px-2 py-2.5 text-center font-medium whitespace-nowrap">
                    {m.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.person.id}>
                  <td className="sticky left-0 bg-surface px-4 py-2 whitespace-nowrap">
                    <div className="font-medium">{r.person.name}</div>
                    <div className="text-xs text-ink-faint">{r.person.department?.name ?? r.person.email}</div>
                  </td>
                  {data.modules.map((m) => {
                    const cell = r.cells[m.key];
                    const personal = PERSONAL[cell.personal];
                    return (
                      <td key={m.key} className="px-2 py-2 text-center" title={cell.expiresAt ? `Temporary until ${formatDateTime(cell.expiresAt)}` : undefined}>
                        <div className="flex flex-col items-center gap-0.5">
                          {cell.visible ? <Check className="size-4 text-ok" aria-label="Visible" /> : <Minus className="size-4 text-ink-faint" aria-label="Not visible" />}
                          {personal && <Badge tone={personal.tone}>{personal.label}{cell.expiresAt ? " ⏱" : ""}</Badge>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-faint">⏱ = temporary access that switches off by itself. Change a person&apos;s access from People → Access.</p>
    </>
  );
}

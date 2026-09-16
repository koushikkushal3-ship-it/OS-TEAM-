"use client";

import { Play, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Switch } from "@/components/ui/primitives";
import { type AutomationRule, useAutomations, useControl } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";

/** The one setting each trigger needs, so the form stays a single field. */
const SETTING: Record<string, { key: string; label: string; min: number; max: number; fallback: number } | null> = {
  TASK_OVERDUE: { key: "days", label: "Days past the due date", min: 0, max: 60, fallback: 2 },
  TICKET_STALE: { key: "hours", label: "Hours open", min: 1, max: 720, fallback: 48 },
  BUDGET_THRESHOLD: { key: "percent", label: "Percent of budget spent", min: 1, max: 100, fallback: 80 },
  EXPENSE_TWO_APPROVERS: { key: "minAmount", label: "From this amount (₹)", min: 0, max: 100_000_000, fallback: 10000 },
  WEEKLY_REPORT: null,
};

function RuleDialog({ rule, triggers, onClose }: { rule?: AutomationRule; triggers: { key: string; label: string }[]; onClose: () => void }) {
  const { saveRule } = useControl();
  const [trigger, setTrigger] = useState(rule?.trigger ?? "TASK_OVERDUE");
  const setting = SETTING[trigger];
  const [name, setName] = useState(rule?.name ?? "");
  const [value, setValue] = useState<number>(Number(rule?.config[setting?.key ?? ""] ?? setting?.fallback ?? 0));

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? `Edit ${rule.name}` : "New automation"}
      submitLabel={rule ? "Save" : "Create"}
      submitting={saveRule.isPending}
      error={saveRule.error ? errorMessage(saveRule.error) : null}
      onSubmit={() => saveRule.mutate({ id: rule?.id, name, trigger, config: setting ? { [setting.key]: value } : {} }, { onSuccess: onClose })}
    >
      <Field label="Name" htmlFor="au-name">
        <Input id="au-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="When" htmlFor="au-trigger">
        <Select
          id="au-trigger"
          value={trigger}
          onChange={(e) => {
            setTrigger(e.target.value);
            setValue(SETTING[e.target.value]?.fallback ?? 0);
          }}
        >
          {triggers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {setting && (
        <Field label={setting.label} htmlFor="au-value">
          <Input id="au-value" type="number" required min={setting.min} max={setting.max} value={value} onChange={(e) => setValue(Number(e.target.value))} />
        </Field>
      )}
    </Dialog>
  );
}

export default function AutomationsPage() {
  const { data, isLoading } = useAutomations();
  const control = useControl();
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const error = control.saveRule.error ?? control.runRule.error ?? control.deleteRule.error;

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Automations"
        description="Simple rules that run every few minutes. Each one says exactly what it does; people are alerted once per item, never repeatedly. Meeting reminders 15 minutes before start are always on."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New rule
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(error)}</ErrorNote>
        </div>
      )}
      <Card>
        {isLoading || !data ? (
          <Spinner />
        ) : !data.rules.length ? (
          <EmptyState icon={<Zap className="size-6" />} title="No automations" />
        ) : (
          <ul className="divide-y divide-line">
            {data.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Switch label={`${r.name} on or off`} checked={r.enabled} onChange={(enabled) => control.saveRule.mutate({ id: r.id, enabled })} />
                <div className="min-w-60 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.name} {!r.enabled && <Badge>off</Badge>}
                  </div>
                  <div className="text-[13px] text-ink-soft">{r.description}</div>
                  <div className="text-xs text-ink-faint">
                    Last run {formatDateTime(r.lastRunAt)} · fired for {r._count.firings} item(s)
                  </div>
                </div>
                {r.trigger !== "EXPENSE_TWO_APPROVERS" && (
                  <Button size="sm" variant="ghost" loading={control.runRule.isPending && control.runRule.variables === r.id} onClick={() => control.runRule.mutate(r.id)}>
                    <Play className="size-3.5" /> Run now
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete ${r.name}?`) && control.deleteRule.mutate(r.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && data && <RuleDialog key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? undefined : editing} triggers={data.triggers} onClose={() => setEditing(null)} />}
    </>
  );
}

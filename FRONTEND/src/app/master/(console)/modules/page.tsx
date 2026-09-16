"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Switch } from "@/components/ui/primitives";
import { useConfigureModule, useModules, useUpdateModule } from "@/features/administration/api";
import { errorMessage } from "@/lib/api/client";
import type { ModuleRow } from "@/lib/api/types";

/** Modules whose settings the console can edit today. */
const CONFIGURABLE = new Set(["attendance", "finance"]);

function ConfigDialog({ module: mod, onClose }: { module: ModuleRow; onClose: () => void }) {
  const configure = useConfigureModule();
  const config = (mod.config ?? {}) as Record<string, number | boolean | undefined>;
  const isFinance = mod.key === "finance";

  const [allowSelfReview, setAllowSelfReview] = useState(config.allowSelfReview === true);
  const [form, setForm] = useState({
    lateAfterMinutes: String(config.lateAfterMinutes ?? 5),
    partialBelowPercent: String(config.partialBelowPercent ?? 60),
    absentBelowPercent: String(config.absentBelowPercent ?? 20),
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${mod.name} settings`}
      description={
        isFinance
          ? "Who may approve what, when the organization is too small for separate reviewers."
          : "Thresholds that turn recorded join and leave times into Present, Late, Partial or Absent."
      }
      submitLabel="Save settings"
      submitting={configure.isPending}
      error={configure.error ? errorMessage(configure.error) : null}
      onSubmit={() =>
        configure.mutate(
          {
            key: mod.key,
            config: isFinance
              ? { allowSelfReview }
              : {
                  lateAfterMinutes: Number(form.lateAfterMinutes),
                  partialBelowPercent: Number(form.partialBelowPercent),
                  absentBelowPercent: Number(form.absentBelowPercent),
                },
          },
          { onSuccess: onClose },
        )
      }
    >
      {isFinance ? (
        <label className="flex items-start gap-3 rounded-lg border border-line px-4 py-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={allowSelfReview} onChange={(e) => setAllowSelfReview(e.target.checked)} />
          <span>
            <span className="text-sm font-medium">Allow approving your own expense</span>
            <span className="mt-0.5 block text-xs text-ink-soft">
              Off by default: whoever submits an expense cannot approve it. Turn it on only while the organization is
              too small to have a second reviewer. Every approval is still recorded in the audit log.
            </span>
          </span>
        </label>
      ) : (
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Late after (min)" htmlFor="cfg-late">
          <Input id="cfg-late" type="number" min={0} max={120} value={form.lateAfterMinutes} onChange={(e) => set({ lateAfterMinutes: e.target.value })} />
        </Field>
        <Field label="Partial below (%)" htmlFor="cfg-partial">
          <Input id="cfg-partial" type="number" min={1} max={100} value={form.partialBelowPercent} onChange={(e) => set({ partialBelowPercent: e.target.value })} />
        </Field>
        <Field label="Absent below (%)" htmlFor="cfg-absent">
          <Input id="cfg-absent" type="number" min={0} max={100} value={form.absentBelowPercent} onChange={(e) => set({ absentBelowPercent: e.target.value })} />
        </Field>
      </div>
      )}
      {!isFinance && (
        <p className="text-xs text-ink-faint">
          Example: late after 5 minutes, partial below 60%, absent below 20% of the meeting length.
        </p>
      )}
    </Dialog>
  );
}

export default function ModulesPage() {
  const modules = useModules();
  const update = useUpdateModule();
  const [configuring, setConfiguring] = useState<ModuleRow | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Modules"
        description="Turn modules on or off for the whole organization. A disabled module disappears from navigation and all its permissions are denied."
      />
      {update.error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(update.error)}</ErrorNote>
        </div>
      )}
      {modules.isLoading ? (
        <Spinner />
      ) : (
        <Card className="divide-y divide-line">
          {modules.data?.map((m) => (
            <div key={m.key} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{m.name}</span>
                  {m.isCore && <Badge>Core</Badge>}
                  {m.status === "PLANNED" && <Badge>Phase {m.phase}</Badge>}
                  {m.status === "DISABLED" && <Badge tone="warn">Disabled</Badge>}
                  {m.status === "ENABLED" && !m.isCore && <Badge tone="ok">Enabled</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{m.description}</p>
              </div>
              <span className="text-xs text-ink-faint">{m._count.permissions} permissions</span>
              {CONFIGURABLE.has(m.key) && (
                <Button size="sm" variant="secondary" onClick={() => setConfiguring(m)}>
                  <Settings2 className="size-3.5" /> Settings
                </Button>
              )}
              <Switch
                label={`${m.name} enabled`}
                checked={m.status === "ENABLED"}
                disabled={m.isCore || update.isPending}
                onChange={(on) => update.mutate({ key: m.key, status: on ? "ENABLED" : "DISABLED" })}
              />
            </div>
          ))}
        </Card>
      )}
      <p className="mt-3 text-xs text-ink-faint">
        Modules marked with a phase are placeholders until that phase is built. Enabling them early only activates their permissions.
      </p>

      {configuring && <ConfigDialog key={configuring.key} module={configuring} onClose={() => setConfiguring(null)} />}
    </>
  );
}

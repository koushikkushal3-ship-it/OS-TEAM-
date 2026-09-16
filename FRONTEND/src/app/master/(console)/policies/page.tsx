"use client";

import { useState } from "react";
import { Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Spinner, Switch } from "@/components/ui/primitives";
import { useConfigureModule, useModules } from "@/features/administration/api";
import { errorMessage } from "@/lib/api/client";
import type { ModuleRow } from "@/lib/api/types";

type Config = Record<string, unknown>;

/** Organization rules that live on module settings, gathered in one place. */
export default function PoliciesPage() {
  const { data: modules, isLoading } = useModules();
  if (isLoading || !modules) return <Spinner />;
  return <PoliciesForm modules={modules} />;
}

function PoliciesForm({ modules }: { modules: ModuleRow[] }) {
  const configure = useConfigureModule();
  const config = (key: string) => (modules.find((m) => m.key === key)?.config ?? {}) as Config;
  const a = config("attendance");
  const w = (config("reports").weights ?? {}) as Config;

  const [attendance, setAttendance] = useState({
    lateAfterMinutes: Number(a.lateAfterMinutes ?? 5),
    partialBelowPercent: Number(a.partialBelowPercent ?? 60),
    absentBelowPercent: Number(a.absentBelowPercent ?? 20),
  });
  const [weights, setWeights] = useState({
    completion: Number(w.completion ?? 40),
    deadlines: Number(w.deadlines ?? 25),
    updates: Number(w.updates ?? 20),
    attendance: Number(w.attendance ?? 15),
  });
  const [allowSelfReview, setAllowSelfReview] = useState(config("finance").allowSelfReview === true);

  const save = (key: string, patch: Config) => configure.mutate({ key, config: { ...config(key), ...patch } });
  const total = weights.completion + weights.deadlines + weights.updates + weights.attendance;

  const num = (label: string, value: number, onChange: (v: number) => void, id: string, max = 100) => (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Policies" description="The organization's rules in one place. Each change is audited with the old and new value." />
      {configure.error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(configure.error)}</ErrorNote>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Attendance" description="How time in a meeting turns into Present, Late, Partial or Absent." />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
            {num("Late after (minutes)", attendance.lateAfterMinutes, (v) => setAttendance((a) => ({ ...a, lateAfterMinutes: v })), "po-late", 120)}
            {num("Partial below (%)", attendance.partialBelowPercent, (v) => setAttendance((a) => ({ ...a, partialBelowPercent: v })), "po-partial")}
            {num("Absent below (%)", attendance.absentBelowPercent, (v) => setAttendance((a) => ({ ...a, absentBelowPercent: v })), "po-absent")}
            <div className="sm:col-span-3">
              <Button loading={configure.isPending && configure.variables?.key === "attendance"} onClick={() => save("attendance", attendance)}>
                Save attendance rules
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Performance score weights" description={`How much each signal counts. They are rescaled, so they need not add to 100 (now ${total}).`} />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-4">
            {num("Completion", weights.completion, (v) => setWeights((w) => ({ ...w, completion: v })), "po-w1")}
            {num("Deadlines", weights.deadlines, (v) => setWeights((w) => ({ ...w, deadlines: v })), "po-w2")}
            {num("Updates", weights.updates, (v) => setWeights((w) => ({ ...w, updates: v })), "po-w3")}
            {num("Attendance", weights.attendance, (v) => setWeights((w) => ({ ...w, attendance: v })), "po-w4")}
            <div className="sm:col-span-4">
              <Button disabled={total === 0} loading={configure.isPending && configure.variables?.key === "reports"} onClick={() => save("reports", { weights })}>
                Save weights
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Finance" description="Whether someone may approve an expense they submitted themselves." />
          <div className="flex items-center gap-3 px-5 pb-5">
            <Switch
              label="Allow self-review"
              checked={allowSelfReview}
              onChange={(v) => {
                setAllowSelfReview(v);
                save("finance", { allowSelfReview: v });
              }}
            />
            <span className="text-sm">{allowSelfReview ? "Allowed — suits very small teams" : "Someone else must approve (recommended)"}</span>
          </div>
          <p className="px-5 pb-5 text-xs text-ink-faint">Large expenses can also require two approvers — see Automations.</p>
        </Card>
      </div>
    </>
  );
}

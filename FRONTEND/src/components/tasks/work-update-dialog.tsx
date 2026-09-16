"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/primitives";
import { useSubmitWorkUpdate } from "@/features/tasks/api";
import { errorMessage } from "@/lib/api/client";
import type { TaskDetail } from "@/lib/api/types";

/** Daily work update: progress %, what moved, what is blocking (arch doc §19). */
export function WorkUpdateDialog({ task, open, onClose }: { task: TaskDetail; open: boolean; onClose: () => void }) {
  const submit = useSubmitWorkUpdate(task.id);
  const [form, setForm] = useState({ percentage: task.percentage, summary: "", blockers: "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const close = () => {
    submit.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Daily work update"
      description={task.title}
      submitLabel="Submit update"
      submitting={submit.isPending}
      error={submit.error ? errorMessage(submit.error) : null}
      onSubmit={() =>
        submit.mutate(
          { percentage: form.percentage, summary: form.summary, blockers: form.blockers || null },
          { onSuccess: close },
        )
      }
    >
      <Field label={`Progress — ${form.percentage}%`} htmlFor="wu-progress" hint="100% sends the task to your lead for review.">
        <div className="flex items-center gap-3">
          <input
            id="wu-progress"
            type="range"
            min={0}
            max={100}
            step={5}
            value={form.percentage}
            onChange={(e) => set({ percentage: Number(e.target.value) })}
            className="h-2 w-full accent-brand"
          />
          <span className="w-12 text-right text-sm font-semibold tabular-nums">{form.percentage}%</span>
        </div>
      </Field>
      <Field label="Work done" htmlFor="wu-summary">
        <Textarea id="wu-summary" required minLength={3} value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="What you finished, what is left" />
      </Field>
      <Field label="Blockers" htmlFor="wu-blockers" hint="Leave empty if nothing is blocking. Filling this marks the task Blocked.">
        <Textarea id="wu-blockers" value={form.blockers} onChange={(e) => set({ blockers: e.target.value })} placeholder="Waiting on sponsor logo, need venue confirmation…" />
      </Field>
    </Dialog>
  );
}

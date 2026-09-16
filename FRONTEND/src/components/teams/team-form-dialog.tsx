"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useDepartments, usePeople } from "@/features/people/api";
import type { TeamInput } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import { useCan } from "@/lib/permissions/can";

export function TeamFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
  error,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<TeamInput>;
  onSave: (input: TeamInput) => void;
  saving: boolean;
  error: unknown;
  mode: "create" | "edit";
}) {
  const can = useCan();
  const departments = useDepartments(open && can("department.view"));
  const people = usePeople({}, open && mode === "create" && can("user.view"));
  const [form, setForm] = useState<TeamInput>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    departmentId: initial?.departmentId ?? "",
    leadUserId: "",
    isActive: initial?.isActive ?? true,
  });
  const set = (patch: Partial<TeamInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Create team" : "Edit team"}
      description={mode === "create" ? "Teams can work on many events, and people can belong to many teams." : undefined}
      submitLabel={mode === "create" ? "Create team" : "Save changes"}
      submitting={saving}
      error={error ? errorMessage(error) : null}
      onSubmit={() =>
        onSave({
          name: form.name,
          description: form.description || null,
          departmentId: form.departmentId || null,
          ...(mode === "create" && form.leadUserId ? { leadUserId: form.leadUserId } : {}),
          ...(mode === "edit" ? { isActive: form.isActive } : {}),
        })
      }
    >
      <Field label="Team name" htmlFor="team-name">
        <Input id="team-name" required minLength={2} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Logistics Team" />
      </Field>
      <Field label="Description" htmlFor="team-desc">
        <Textarea id="team-desc" value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="What this team is responsible for" />
      </Field>
      {departments.data && (
        <Field label="Department" htmlFor="team-dept">
          <Select id="team-dept" value={form.departmentId ?? ""} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">No department</option>
            {departments.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4 accent-brand" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Team is active
        </label>
      )}
      {mode === "create" && people.data && (
        <Field label="Team lead" htmlFor="team-lead" hint="Optional — you can add members and co-leads after creating the team.">
          <Select id="team-lead" value={form.leadUserId} onChange={(e) => set({ leadUserId: e.target.value })}>
            <option value="">Choose later</option>
            {people.data
              .filter((p) => p.status !== "DISABLED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.email}
                </option>
              ))}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

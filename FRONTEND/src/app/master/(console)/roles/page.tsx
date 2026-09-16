"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { useDeleteRole, usePermissionCatalog, useRoles, useSaveRole } from "@/features/administration/api";
import { useDepartments } from "@/features/people/api";
import { errorMessage } from "@/lib/api/client";
import type { Role } from "@/lib/api/types";

interface Draft {
  id?: string;
  name: string;
  description: string;
  departmentId: string;
  reportsToRoleId: string;
  isActive: boolean;
  isMasterAdmin: boolean;
  permissionKeys: Set<string>;
}

const toDraft = (r?: Role): Draft => ({
  id: r?.id,
  name: r?.name ?? "",
  description: r?.description ?? "",
  departmentId: r?.department?.id ?? "",
  reportsToRoleId: r?.reportsTo?.id ?? "",
  isActive: r?.isActive ?? true,
  isMasterAdmin: r?.isMasterAdmin ?? false,
  permissionKeys: new Set(r?.permissions.map((p) => p.permissionKey)),
});

function RoleDialog({ draft: initial, roles, onClose }: { draft: Draft; roles: Role[]; onClose: () => void }) {
  const catalog = usePermissionCatalog();
  const departments = useDepartments();
  const save = useSaveRole();
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(draft.permissionKeys);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    set({ permissionKeys: next });
  };

  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title={draft.id ? `Edit role · ${initial.name}` : "Create role"}
      description="Roles are fully configurable: name, place in the structure, and exactly which actions they allow."
      submitLabel={draft.id ? "Save role" : "Create role"}
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            id: draft.id,
            name: draft.name,
            description: draft.description || null,
            departmentId: draft.departmentId || null,
            reportsToRoleId: draft.reportsToRoleId || null,
            ...(draft.id && { isActive: draft.isActive }),
            ...(!draft.isMasterAdmin && { permissionKeys: [...draft.permissionKeys] }),
          },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role name" htmlFor="role-name">
          <Input id="role-name" required minLength={2} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Sponsorship Lead" />
        </Field>
        <Field label="Department" htmlFor="role-dept">
          <Select id="role-dept" value={draft.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
            <option value="">None</option>
            {departments.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reports to" htmlFor="role-reports">
          <Select id="role-reports" value={draft.reportsToRoleId} onChange={(e) => set({ reportsToRoleId: e.target.value })}>
            <option value="">None</option>
            {roles
              .filter((r) => r.id !== draft.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
        </Field>
        {draft.id && !draft.isMasterAdmin && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            Role is active
          </label>
        )}
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="role-desc">
            <Textarea id="role-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
      </div>

      {draft.isMasterAdmin ? (
        <p className="rounded-lg bg-master-soft px-3 py-2 text-[13px] text-master">
          Master Admin access isn&apos;t permission-based: holders get full control only inside a verified privileged session.
        </p>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium">Permissions</span>
            <span className="text-xs text-ink-faint">{draft.permissionKeys.size} selected</span>
          </div>
          {catalog.isLoading && <Spinner />}
          <div className="space-y-3">
            {catalog.data?.map((m) => {
              const keys = m.permissions.map((p) => p.key);
              const selected = keys.filter((k) => draft.permissionKeys.has(k)).length;
              return (
                <fieldset key={m.key} className="rounded-lg border border-line">
                  <legend className="sr-only">{m.name}</legend>
                  <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      aria-label={`All ${m.name} permissions`}
                      checked={selected === keys.length}
                      ref={(el) => {
                        if (el) el.indeterminate = selected > 0 && selected < keys.length;
                      }}
                      onChange={(e) => toggle(keys, e.target.checked)}
                    />
                    <span className="text-[13px] font-medium">{m.name}</span>
                    {m.status !== "ENABLED" && <Badge tone={m.status === "PLANNED" ? "neutral" : "warn"}>{m.status === "PLANNED" ? `Phase ${m.phase}` : "Disabled"}</Badge>}
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 p-3 sm:grid-cols-2">
                    {m.permissions.map((p) => (
                      <label key={p.key} className="flex items-start gap-2 text-[13px]">
                        <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={draft.permissionKeys.has(p.key)} onChange={(e) => toggle([p.key], e.target.checked)} />
                        <span>
                          {p.description}
                          <code className="block font-mono text-[11px] text-ink-faint">{p.key}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function RolesPage() {
  const roles = useRoles();
  const remove = useDeleteRole();
  const [draft, setDraft] = useState<Draft | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Role[]>();
    roles.data?.forEach((r) => {
      const key = r.department?.name ?? "No department";
      map.set(key, [...(map.get(key) ?? []), r]);
    });
    return [...map.entries()];
  }, [roles.data]);

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Roles"
        description="No role is hard-coded. Create any lead, management or custom role and choose exactly what it can do."
        actions={
          <Button onClick={() => setDraft(toDraft())}>
            <Plus className="size-4" /> Create role
          </Button>
        }
      />
      {remove.error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(remove.error)}</ErrorNote>
        </div>
      )}

      {roles.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {grouped.map(([dept, list]) => (
            <section key={dept}>
              <h2 className="mb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">{dept}</h2>
              <Card className="divide-y divide-line">
                {list.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {r.name}
                        {r.isMasterAdmin && <Badge tone="master">Control plane</Badge>}
                        {r.isSystem && !r.isMasterAdmin && <Badge>System</Badge>}
                        {!r.isActive && <Badge tone="warn">Inactive</Badge>}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {r.reportsTo ? `Reports to ${r.reportsTo.name} · ` : ""}
                        {r.isMasterAdmin ? "Full access in privileged session" : `${r.permissions.length} permissions`}
                      </div>
                    </div>
                    <span className="text-xs text-ink-faint">{r._count.users} people</span>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setDraft(toDraft(r))}>
                      <Pencil className="size-3.5" />
                    </Button>
                    {!r.isSystem && (
                      <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete role ${r.name}?`) && remove.mutate(r.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      {draft && roles.data && <RoleDialog key={draft.id ?? "new"} draft={draft} roles={roles.data} onClose={() => setDraft(null)} />}
    </>
  );
}

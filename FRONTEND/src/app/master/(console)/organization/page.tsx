"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Spinner, Textarea } from "@/components/ui/primitives";
import { useDeleteDepartment, useOrganization, useSaveDepartment, useUpdateOrganization } from "@/features/administration/api";
import { useDepartments } from "@/features/people/api";
import { errorMessage } from "@/lib/api/client";
import type { Department } from "@/lib/api/types";

export default function OrganizationPage() {
  const org = useOrganization();
  const updateOrg = useUpdateOrganization();
  const departments = useDepartments();
  const save = useSaveDepartment();
  const remove = useDeleteDepartment();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Department> | null>(null);

  if (org.isLoading || departments.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Organization" description="The organization profile and its department structure." />

      <Card className="mb-6">
        <CardHeader title="Profile" />
        <form
          className="flex flex-wrap items-end gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (orgName) updateOrg.mutate(orgName, { onSuccess: () => setOrgName(null) });
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="Organization name" htmlFor="org-name">
              <Input id="org-name" value={orgName ?? org.data?.name ?? ""} onChange={(e) => setOrgName(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={!orgName || orgName === org.data?.name} loading={updateOrg.isPending}>
            Save
          </Button>
          {updateOrg.error && <ErrorNote>{errorMessage(updateOrg.error)}</ErrorNote>}
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Departments"
          description="Departments group roles, people and teams. Add new ones any time — no code changes."
          action={
            <Button size="sm" onClick={() => setEditing({ name: "", description: "" })}>
              <Plus className="size-3.5" /> Add department
            </Button>
          }
        />
        {remove.error && (
          <div className="px-5 pt-4">
            <ErrorNote>{errorMessage(remove.error)}</ErrorNote>
          </div>
        )}
        <ul className="divide-y divide-line">
          {departments.data?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {d.name} {!d.isActive && <Badge>Inactive</Badge>}
                </div>
                {d.description && <div className="text-xs text-ink-soft">{d.description}</div>}
              </div>
              <span className="text-xs text-ink-faint">
                {d._count.users} people · {d._count.teams} teams · {d._count.roles} roles
              </span>
              <Button size="sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => setEditing(d)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => confirm(`Delete ${d.name}?`) && remove.mutate(d.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {editing && (
        <Dialog
          open
          onClose={() => {
            setEditing(null);
            save.reset();
          }}
          title={editing.id ? "Edit department" : "Add department"}
          submitting={save.isPending}
          error={save.error ? errorMessage(save.error) : null}
          onSubmit={() =>
            save.mutate(
              { id: editing.id, name: editing.name ?? "", description: editing.description || null, isActive: editing.isActive ?? true },
              { onSuccess: () => setEditing(null) },
            )
          }
        >
          <Field label="Name" htmlFor="dept-name">
            <Input id="dept-name" required minLength={2} value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Sponsorship" />
          </Field>
          <Field label="Description" htmlFor="dept-desc">
            <Textarea id="dept-desc" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </Field>
          {editing.id && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand" checked={editing.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
              Department is active
            </label>
          )}
        </Dialog>
      )}
    </>
  );
}

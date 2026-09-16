"use client";

import { Blocks, GripVertical, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import {
  type CustomDefinition,
  type DefinitionInput,
  FIELD_TYPES,
  type FieldDef,
  type FieldType,
  useDefinitions,
  useDeleteDefinition,
  useSaveDefinition,
} from "@/features/custom/api";
import { errorMessage } from "@/lib/api/client";
import { titleCase } from "@/lib/format";
import { isPendingApproval } from "@/features/platform/api";

const blankField = (): FieldDef => ({ key: "", label: "", type: "text", required: false });

/** Turns a label into a safe field key so nobody has to think about identifiers. */
const keyFromLabel = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "f$1")
    .slice(0, 40);

function BuilderDialog({ existing, onClose }: { existing?: CustomDefinition; onClose: () => void }) {
  const save = useSaveDefinition();
  const [form, setForm] = useState<DefinitionInput>({
    name: existing?.name ?? "",
    description: existing?.description ?? "",
    icon: existing?.icon ?? "Blocks",
    fields: existing?.fields ?? [{ key: "owner_note", label: "Notes", type: "textarea", required: false }],
    statuses: existing?.statuses ?? ["New", "In progress", "Done"],
    scopeEvent: existing?.scopeEvent ?? true,
    scopeTeam: existing?.scopeTeam ?? true,
  });
  const [statusText, setStatusText] = useState(form.statuses.join(", "));

  const setField = (index: number, patch: Partial<FieldDef>) =>
    setForm((f) => ({ ...f, fields: f.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) }));

  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Build a module"}
      description="Name it, give it fields and workflow states. TEAM OS creates the pages and the permissions for you."
      submitLabel={existing ? "Save module" : "Create module"}
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            id: existing?.id,
            ...form,
            description: form.description || null,
            statuses: statusText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Module name" htmlFor="b-name" hint={existing ? "The internal key stays the same, so role permissions keep working." : "e.g. Sponsorship Tracker, Volunteer Register"}>
          <Input id="b-name" required minLength={2} autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Workflow states" htmlFor="b-statuses" hint="Comma separated, in order.">
          <Input id="b-statuses" required value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder="New, Contacted, Confirmed" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="b-desc">
            <Textarea id="b-desc" value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
      </div>

      <fieldset>
        <div className="mb-2 flex items-center justify-between">
          <legend className="text-[13px] font-medium">Fields</legend>
          <Button size="sm" variant="secondary" type="button" onClick={() => setForm((f) => ({ ...f, fields: [...f.fields, blankField()] }))}>
            <Plus className="size-3.5" /> Add field
          </Button>
        </div>
        <ul className="space-y-2">
          {form.fields.map((field, index) => (
            <li key={index} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[auto_1fr_1fr_auto_auto] sm:items-end">
              <GripVertical className="mb-2 hidden size-4 text-ink-faint sm:block" />
              <Field label="Label" htmlFor={`b-label-${index}`}>
                <Input
                  id={`b-label-${index}`}
                  required
                  value={field.label}
                  onChange={(e) => setField(index, { label: e.target.value, key: field.key || keyFromLabel(e.target.value) })}
                  placeholder="Company name"
                />
              </Field>
              <Field label="Type" htmlFor={`b-type-${index}`}>
                <Select id={`b-type-${index}`} value={field.type} onChange={(e) => setField(index, { type: e.target.value as FieldType })}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="mb-2 flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="size-4 accent-brand" checked={field.required} onChange={(e) => setField(index, { required: e.target.checked })} />
                Required
              </label>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                aria-label="Remove field"
                className="mb-1"
                onClick={() => setForm((f) => ({ ...f, fields: f.fields.filter((_, i) => i !== index) }))}
              >
                <Trash2 className="size-3.5" />
              </Button>
              {field.type === "select" && (
                <div className="sm:col-span-5">
                  <Field label="Choices" htmlFor={`b-opts-${index}`} hint="Comma separated.">
                    <Input
                      id={`b-opts-${index}`}
                      value={(field.options ?? []).join(", ")}
                      onChange={(e) =>
                        setField(index, {
                          options: e.target.value
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Gold, Silver, Bronze"
                    />
                  </Field>
                </div>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand" checked={form.scopeEvent} onChange={(e) => setForm((f) => ({ ...f, scopeEvent: e.target.checked }))} />
          Records can belong to an event
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand" checked={form.scopeTeam} onChange={(e) => setForm((f) => ({ ...f, scopeTeam: e.target.checked }))} />
          Records can belong to a team
        </label>
      </div>

      <p className="rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-soft">
        Creating this module adds four permissions — view, create, edit, delete. Grant them to roles in{" "}
        <span className="font-medium">Roles</span>, the same as any built-in module.
      </p>
    </Dialog>
  );
}

export default function BuilderPage() {
  const definitions = useDefinitions();
  const remove = useDeleteDefinition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomDefinition | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Module builder"
        description="Add a module the organization needs without touching code — fields, workflow states and permissions included."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Build module
          </Button>
        }
      />

      {remove.error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(remove.error)}</ErrorNote>
        </div>
      )}

      {definitions.isLoading ? (
        <Spinner />
      ) : !definitions.data?.length ? (
        <Card>
          <EmptyState
            icon={<Blocks className="size-6" />}
            title="No custom modules yet"
            description="Sponsorship tracker, volunteer register, logistics list — anything the plan needs next."
            action={<Button onClick={() => setCreating(true)}>Build the first one</Button>}
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {definitions.data.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="min-w-40 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{d.name}</span>
                  <Badge>{d.fields.length} fields</Badge>
                  <Badge>{d.statuses.length} states</Badge>
                  <code className="font-mono text-[11px] text-ink-faint">{d.moduleKey}</code>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">{d.description || "No description"}</p>
              </div>
              <span className="text-xs text-ink-faint">{d._count.records} records</span>
              <Link href={`/m/${d.moduleKey}`} className="text-[13px] font-medium text-brand hover:underline">
                Open
              </Link>
              <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  confirm(`Delete ${d.name}? Its ${d._count.records} records and permissions go with it. This cannot be undone.`) &&
                  remove.mutate(d.id, { onSuccess: (r) => isPendingApproval(r) && alert("Sent for approval: another Master Admin must approve deleting this module in Approvals.") })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </Card>
      )}

      {creating && <BuilderDialog onClose={() => setCreating(false)} />}
      {editing && <BuilderDialog key={editing.id} existing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

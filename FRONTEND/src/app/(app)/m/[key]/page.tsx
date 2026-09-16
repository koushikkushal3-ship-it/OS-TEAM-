"use client";

import { Blocks, Pencil, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { FileAttachments } from "@/components/operations/file-attachments";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import {
  type CustomDefinitionDetail,
  type CustomRecord,
  type FieldDef,
  useCustomDefinition,
  useCustomRecords,
  useDeleteRecord,
  useSaveRecord,
} from "@/features/custom/api";
import { usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

/** Renders one field's value the way its type deserves. */
function displayValue(field: FieldDef, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "money") return formatMoney(Number(value));
  if (field.type === "date") return formatDate(String(value));
  return String(value);
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const id = `f-${field.key}`;
  const text = value === null || value === undefined ? "" : String(value);

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" className="size-4 accent-brand" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }

  const input =
    field.type === "textarea" ? (
      <Textarea id={id} required={field.required} value={text} onChange={(e) => onChange(e.target.value)} />
    ) : field.type === "select" ? (
      <Select id={id} required={field.required} value={text} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    ) : (
      <Input
        id={id}
        required={field.required}
        type={
          field.type === "number" || field.type === "money"
            ? "number"
            : field.type === "date"
              ? "date"
              : field.type === "email"
                ? "email"
                : field.type === "url"
                  ? "url"
                  : field.type === "phone"
                    ? "tel"
                    : "text"
        }
        value={field.type === "date" ? text.slice(0, 10) : text}
        onChange={(e) => onChange(e.target.value)}
      />
    );

  return (
    <Field label={field.required ? `${field.label} *` : field.label} htmlFor={id}>
      {input}
    </Field>
  );
}

function RecordDialog({
  definition,
  record,
  onClose,
}: {
  definition: CustomDefinitionDetail;
  record?: CustomRecord;
  onClose: () => void;
}) {
  const save = useSaveRecord(definition.moduleKey);
  const teams = useTeams();
  const events = useEvents();
  const can = useCan();
  const people = usePeople({}, can("user.view"));

  const [form, setForm] = useState({
    title: record?.title ?? "",
    status: record?.status ?? definition.statuses[0],
    teamId: record?.teamId ?? "",
    eventId: record?.eventId ?? "",
    ownerId: record?.owner?.id ?? "",
    data: (record?.data ?? {}) as Record<string, unknown>,
  });
  const setData = (key: string, value: unknown) => setForm((f) => ({ ...f, data: { ...f.data, [key]: value } }));

  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title={record ? `Edit · ${record.title}` : `New ${definition.name.toLowerCase()} record`}
      submitLabel={record ? "Save changes" : "Add record"}
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            id: record?.id,
            title: form.title,
            status: form.status,
            data: form.data,
            teamId: form.teamId || null,
            eventId: form.eventId || null,
            ownerId: form.ownerId || null,
          },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title *" htmlFor="rec-title">
          <Input id="rec-title" required autoFocus value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Status" htmlFor="rec-status">
          <Select id="rec-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            {definition.statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        {definition.fields.map((field) => (
          <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
            <FieldInput field={field} value={form.data[field.key]} onChange={(v) => setData(field.key, v)} />
          </div>
        ))}
        {definition.scopeEvent && (
          <Field label="Event" htmlFor="rec-event">
            <Select id="rec-event" value={form.eventId} onChange={(e) => setForm((f) => ({ ...f, eventId: e.target.value }))}>
              <option value="">No event</option>
              {events.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {definition.scopeTeam && (
          <Field label="Team" htmlFor="rec-team">
            <Select id="rec-team" value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}>
              <option value="">No team</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {people.data && (
          <Field label="Owner" htmlFor="rec-owner">
            <Select id="rec-owner" value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}>
              <option value="">Me</option>
              {people.data
                .filter((p) => p.status !== "DISABLED")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>

      {record && <FileAttachments entityType="event" entityId={record.id} title="Files" />}
    </Dialog>
  );
}

/** One page that renders any module Master Admin built. */
export default function CustomModulePage() {
  const { key } = useParams<{ key: string }>();
  const { data: definition, isLoading, error } = useCustomDefinition(key);
  const [status, setStatus] = useState("");
  const records = useCustomRecords(key, status ? { status } : {});
  const remove = useDeleteRecord(key);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomRecord | null>(null);

  if (isLoading) return <Spinner />;
  if (error || !definition) return <ErrorNote>{errorMessage(error)}</ErrorNote>;

  // Only the first few fields fit a row; the rest show when editing.
  const columns = definition.fields.slice(0, 3);

  return (
    <>
      <PageHeader
        eyebrow="Custom module"
        title={definition.name}
        description={definition.description ?? "Built in TEAM OS without code."}
        actions={
          definition.capabilities.canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New record
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Status filter">
        <button
          role="tab"
          aria-selected={status === ""}
          onClick={() => setStatus("")}
          className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
        >
          All
        </button>
        {definition.statuses.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {s}
          </button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <CardHeader title="Records" description={`${records.data?.length ?? 0} records`} />
        {records.isLoading ? (
          <Spinner />
        ) : !records.data?.length ? (
          <EmptyState icon={<Blocks className="size-6" />} title="Nothing here yet" description="Add the first record." />
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-subtle text-xs text-ink-soft">
              <tr>
                <th className="px-5 py-2.5 font-medium">Title</th>
                {columns.map((f) => (
                  <th key={f.key} className="px-3 py-2.5 font-medium">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {records.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-ink-faint">
                      {r.event?.name ?? r.team?.name ?? formatDate(r.updatedAt)}
                    </div>
                  </td>
                  {columns.map((f) => (
                    <td key={f.key} className="px-3 py-3 text-ink-soft">
                      {displayValue(f, r.data[f.key])}
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <Badge tone="brand">{r.status}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    {r.owner ? (
                      <span className="flex items-center gap-2 text-xs">
                        <Avatar name={r.owner.name} src={r.owner.avatarUrl} size={22} /> {r.owner.name}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      {definition.capabilities.canUpdate && (
                        <Button size="sm" variant="ghost" aria-label={`Edit ${r.title}`} onClick={() => setEditing(r)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                      {definition.capabilities.canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${r.title}`}
                          onClick={() => confirm(`Delete "${r.title}"?`) && remove.mutate(r.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {remove.error && (
          <div className="px-5 pb-4">
            <ErrorNote>{errorMessage(remove.error)}</ErrorNote>
          </div>
        )}
      </Card>

      {creating && <RecordDialog definition={definition} onClose={() => setCreating(false)} />}
      {editing && <RecordDialog key={editing.id} definition={definition} record={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

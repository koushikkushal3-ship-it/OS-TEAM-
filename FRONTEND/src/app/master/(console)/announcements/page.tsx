"use client";

import { Megaphone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import { useDepartments } from "@/features/people/api";
import { type Announcement, useControl, useMasterAnnouncements } from "@/features/platform/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime, titleCase, toDateTimeInput } from "@/lib/format";

function AnnouncementDialog({ item, onClose }: { item?: Announcement; onClose: () => void }) {
  const { saveAnnouncement } = useControl();
  const teams = useTeams();
  const events = useEvents();
  const departments = useDepartments();
  const [form, setForm] = useState({
    title: item?.title ?? "",
    body: item?.body ?? "",
    scopeType: item?.scopeType ?? "ORGANIZATION",
    scopeId: item?.scopeId ?? "",
    tone: item?.tone ?? "info",
    startsAt: toDateTimeInput(item?.startsAt ?? new Date().toISOString()),
    endsAt: toDateTimeInput(item?.endsAt),
  });
  const options = form.scopeType === "TEAM" ? teams.data : form.scopeType === "EVENT" ? events.data : form.scopeType === "DEPARTMENT" ? departments.data : [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? "Edit announcement" : "New announcement"}
      description="Shown as a banner at the top of the portal for the people it is meant for. Each person can dismiss it."
      submitLabel={item ? "Save" : "Publish"}
      submitting={saveAnnouncement.isPending}
      error={saveAnnouncement.error ? errorMessage(saveAnnouncement.error) : null}
      onSubmit={() =>
        saveAnnouncement.mutate(
          {
            id: item?.id,
            title: form.title,
            body: form.body,
            scopeType: form.scopeType,
            scopeId: form.scopeType === "ORGANIZATION" ? null : form.scopeId,
            tone: form.tone,
            startsAt: new Date(form.startsAt).toISOString(),
            endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          },
          { onSuccess: onClose },
        )
      }
    >
      <Field label="Title" htmlFor="an-title">
        <Input id="an-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      </Field>
      <Field label="Message" htmlFor="an-body">
        <Textarea id="an-body" required value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="For" htmlFor="an-scope">
          <Select id="an-scope" value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as Announcement["scopeType"], scopeId: "" }))}>
            <option value="ORGANIZATION">Everyone</option>
            <option value="DEPARTMENT">One department</option>
            <option value="TEAM">One team</option>
            <option value="EVENT">One event</option>
          </Select>
        </Field>
        {form.scopeType !== "ORGANIZATION" ? (
          <Field label={titleCase(form.scopeType)} htmlFor="an-scope-id">
            <Select id="an-scope-id" required value={form.scopeId} onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}>
              <option value="">Select…</option>
              {options?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Style" htmlFor="an-tone">
            <Select id="an-tone" value={form.tone} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value as Announcement["tone"] }))}>
              <option value="info">Information</option>
              <option value="warning">Warning</option>
              <option value="success">Good news</option>
            </Select>
          </Field>
        )}
        <Field label="Show from" htmlFor="an-start">
          <Input id="an-start" type="datetime-local" required value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
        </Field>
        <Field label="Until (optional)" htmlFor="an-end">
          <Input id="an-end" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
        </Field>
      </div>
    </Dialog>
  );
}

export default function AnnouncementsPage() {
  const { data, isLoading } = useMasterAnnouncements();
  const { deleteAnnouncement } = useControl();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [now] = useState(() => Date.now());

  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Announcements"
        description="Pinned banners for everyone, or for one department, team or event."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New announcement
          </Button>
        }
      />
      {deleteAnnouncement.error && <ErrorNote>{errorMessage(deleteAnnouncement.error)}</ErrorNote>}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={<Megaphone className="size-6" />} title="No announcements" />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((a) => {
              const live = new Date(a.startsAt).getTime() <= now && (!a.endsAt || new Date(a.endsAt).getTime() > now);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-60 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {a.title}
                      <Badge tone={live ? "ok" : "neutral"}>{live ? "showing" : new Date(a.startsAt).getTime() > now ? "scheduled" : "ended"}</Badge>
                      <Badge>{a.scopeType === "ORGANIZATION" ? "Everyone" : titleCase(a.scopeType)}</Badge>
                    </div>
                    <div className="text-[13px] text-ink-soft">{a.body}</div>
                    <div className="text-xs text-ink-faint">
                      {formatDateTime(a.startsAt)}
                      {a.endsAt && ` → ${formatDateTime(a.endsAt)}`}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Delete announcement" onClick={() => confirm(`Delete "${a.title}"?`) && deleteAnnouncement.mutate(a.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <AnnouncementDialog key={editing === "new" ? "new" : editing.id} item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

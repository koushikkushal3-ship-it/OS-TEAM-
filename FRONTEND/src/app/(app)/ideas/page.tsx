"use client";

import { Lightbulb, Plus } from "lucide-react";
import { useState } from "react";
import { FileAttachments } from "@/components/operations/file-attachments";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import { type IdeaInput, useIdea, useIdeaStats, useIdeas, useReviewIdea, useSaveIdea } from "@/features/operations/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { IdeaStatus } from "@/lib/api/types";
import { formatDate, ideaStatusLabel, ideaStatusTone } from "@/lib/format";
import { Can } from "@/lib/permissions/can";

const STATUSES: IdeaStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "IMPLEMENTING", "IMPLEMENTED"];
const TABS = [
  { id: "ALL", label: "All" },
  { id: "SUBMITTED", label: "Awaiting review" },
  { id: "ACCEPTED", label: "Accepted" },
  { id: "IMPLEMENTED", label: "Implemented" },
  { id: "MINE", label: "Mine" },
] as const;

function SubmitDialog({ onClose }: { onClose: () => void }) {
  const save = useSaveIdea();
  const events = useEvents();
  const teams = useTeams();
  const [form, setForm] = useState<IdeaInput>({ title: "", category: "", summary: "", eventId: "", teamId: "" });
  const set = (patch: Partial<IdeaInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      open
      onClose={onClose}
      title="Submit an idea"
      description="A formal submission with a document — reviewed and decided, not lost in chat."
      submitLabel="Submit idea"
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() => save.mutate({ ...form, eventId: form.eventId || null, teamId: form.teamId || null }, { onSuccess: onClose })}
    >
      <Field label="Title" htmlFor="id-title">
        <Input id="id-title" required minLength={3} autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Student ambassador programme" />
      </Field>
      <Field label="Category" htmlFor="id-cat">
        <Input id="id-cat" required list="id-cats" value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Marketing" />
        <datalist id="id-cats">
          {["Marketing", "Operations", "Technical", "Content", "Sponsorship", "Experience", "Other"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Summary" htmlFor="id-summary" hint="Attach the full PDF after submitting.">
        <Textarea id="id-summary" required minLength={10} className="min-h-28" value={form.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="What the idea is, why it helps, what it needs" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event" htmlFor="id-event">
          <Select id="id-event" value={form.eventId ?? ""} onChange={(e) => set({ eventId: e.target.value })}>
            <option value="">No event</option>
            {events.data?.map((e2) => (
              <option key={e2.id} value={e2.id}>
                {e2.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="id-team">
          <Select id="id-team" value={form.teamId ?? ""} onChange={(e) => set({ teamId: e.target.value })}>
            <option value="">No team</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function IdeaDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: idea, isLoading } = useIdea(id);
  const review = useReviewIdea(id);
  const [status, setStatus] = useState<IdeaStatus | "">("");
  const [note, setNote] = useState("");

  if (isLoading || !idea) {
    return (
      <Dialog open onClose={onClose} title="Idea">
        <Spinner />
      </Dialog>
    );
  }

  return (
    <Dialog wide open onClose={onClose} title={idea.title} description={`${idea.category} · submitted ${formatDate(idea.createdAt)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ideaStatusTone[idea.status]}>{ideaStatusLabel[idea.status]}</Badge>
        {idea.event && <Badge>{idea.event.name}</Badge>}
        {idea.team && <Badge>{idea.team.name}</Badge>}
        {idea.submittedBy && (
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
            <Avatar name={idea.submittedBy.name} src={idea.submittedBy.avatarUrl} size={22} /> {idea.submittedBy.name}
          </span>
        )}
      </div>

      <p className="text-sm whitespace-pre-wrap">{idea.summary}</p>

      {idea.decisionNote && (
        <p className="rounded-lg bg-subtle px-3 py-2 text-[13px]">
          <span className="font-medium">Decision:</span> {idea.decisionNote}
          {idea.reviewedBy ? ` — ${idea.reviewedBy.name}` : ""}
        </p>
      )}

      <FileAttachments entityType="idea" entityId={id} title="Proposal documents" kinds={["PROPOSAL", "DOCUMENT", "ATTACHMENT"]} />

      {idea.capabilities.canReview && (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Decision" htmlFor="id-status">
              <Select id="id-status" value={status || idea.status} onChange={(e) => setStatus(e.target.value as IdeaStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ideaStatusLabel[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note" htmlFor="id-note">
              <Input id="id-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why, and what happens next" />
            </Field>
          </div>
          <ErrorNote>{review.error && errorMessage(review.error)}</ErrorNote>
          <Button
            loading={review.isPending}
            onClick={() => review.mutate({ status: (status || idea.status) as IdeaStatus, note: note || undefined }, { onSuccess: onClose })}
          >
            Record decision
          </Button>
        </div>
      )}
    </Dialog>
  );
}

export default function IdeasPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("ALL");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const ideas = useIdeas(tab === "ALL" ? {} : tab === "MINE" ? { mine: true } : { status: tab as IdeaStatus });
  const stats = useIdeaStats();

  return (
    <>
      <PageHeader
        eyebrow="05 · Knowledge"
        title="Ideas"
        description="Formal proposals with documents, reviewed and decided — organizational memory, not chat."
        actions={
          <Can permission="idea.submit">
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Submit idea
            </Button>
          </Can>
        }
      />

      {stats.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total ideas" value={stats.data.total} icon={<Lightbulb className="size-4" />} />
          <Stat label="Awaiting review" value={stats.data.awaitingReview} />
          <Stat label="Accepted" value={stats.data.accepted} />
          <Stat label="Implemented" value={stats.data.implemented} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Idea filter">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title="Ideas" />
        {ideas.isLoading ? (
          <Spinner />
        ) : !ideas.data?.length ? (
          <EmptyState icon={<Lightbulb className="size-6" />} title="No ideas here yet" description="Submitted ideas appear here for review." />
        ) : (
          <ul className="divide-y divide-line">
            {ideas.data.map((i) => (
              <li key={i.id}>
                <button onClick={() => setOpenId(i.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-subtle">
                  <div className="min-w-40 flex-1">
                    <div className="truncate text-sm font-medium">{i.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
                      <span>{i.category}</span>
                      {i.event && <span>{i.event.name}</span>}
                      <span>{formatDate(i.createdAt)}</span>
                    </div>
                  </div>
                  <Badge tone={ideaStatusTone[i.status]}>{ideaStatusLabel[i.status]}</Badge>
                  {i.submittedBy && <Avatar name={i.submittedBy.name} src={i.submittedBy.avatarUrl} size={26} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <SubmitDialog onClose={() => setCreating(false)} />}
      {openId && <IdeaDialog key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

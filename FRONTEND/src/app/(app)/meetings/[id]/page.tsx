"use client";

import { ArrowLeft, CalendarClock, CheckSquare, Clock, ExternalLink, Gavel, MapPin, Pencil, Play, Square, Trash2, UserPlus, Video } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { MeetingFormDialog } from "@/components/meetings/meeting-form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import {
  useAddActionItem,
  useAddDecision,
  useAddSession,
  useDeleteMeeting,
  useMeeting,
  useMeetingLifecycle,
  useMeetingNotes,
  useOverrideAttendance,
  useRemoveActionItem,
  useRemoveDecision,
  useRemoveParticipant,
  useSetParticipant,
  useUpdateMeeting,
} from "@/features/meetings/api";
import { usePeople } from "@/features/people/api";
import { errorMessage } from "@/lib/api/client";
import type { AttendanceStatus } from "@/lib/api/types";
import {
  attendanceLabel,
  attendanceTone,
  durationLabel,
  formatMeetingWhen,
  formatTime,
  meetingStatusTone,
  meetingTypeLabel,
  titleCase,
} from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const STATUSES: AttendanceStatus[] = ["UNKNOWN", "PRESENT", "LATE", "PARTIAL", "ABSENT", "EXCUSED"];

export default function MeetingRoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const { data: meeting, isLoading, error } = useMeeting(id);
  const lifecycle = useMeetingLifecycle(id);
  const update = useUpdateMeeting(id);
  const remove = useDeleteMeeting();
  const saveNotes = useMeetingNotes(id);
  const addDecision = useAddDecision(id);
  const removeDecision = useRemoveDecision(id);
  const addAction = useAddActionItem(id);
  const removeAction = useRemoveActionItem(id);
  const setParticipant = useSetParticipant(id);
  const removeParticipant = useRemoveParticipant(id);
  const override = useOverrideAttendance(id);
  const addSession = useAddSession(id);
  const people = usePeople({}, can("user.view"));

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [decision, setDecision] = useState("");
  const [action, setAction] = useState({ text: "", ownerId: "", dueDate: "", createTask: true });
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPerson, setNewPerson] = useState("");
  const [sessionFor, setSessionFor] = useState<string | null>(null);
  const [session, setSession] = useState({ joinedAt: "", leftAt: "" });

  if (isLoading) return <Spinner />;
  if (error || !meeting) return <ErrorNote>{errorMessage(error)}</ErrorNote>;

  const { canManage, canEnd, canJoin } = meeting.capabilities;
  const canMarkAttendance = can("attendance.manage");
  const live = meeting.status === "LIVE";
  const ended = meeting.status === "ENDED";
  const participantIds = new Set(meeting.participants.map((p) => p.user.id));

  const openLink = (url: string | null) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Link href="/meetings" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
        <ArrowLeft className="size-3.5" /> Meetings
      </Link>

      <PageHeader
        eyebrow={meetingTypeLabel[meeting.type]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {meeting.title}
            <Badge tone={meetingStatusTone[meeting.status]}>{live ? "Live now" : titleCase(meeting.status)}</Badge>
          </span>
        }
        description={meeting.description ?? undefined}
        actions={
          <>
            {!ended && canJoin && (
              <Button
                loading={lifecycle.join.isPending}
                onClick={() => lifecycle.join.mutate(undefined, { onSuccess: (r) => openLink(r.joinUrl) })}
              >
                <Video className="size-4" /> Join
              </Button>
            )}
            {!ended && canManage && !live && (
              <Button variant="secondary" loading={lifecycle.start.isPending} onClick={() => lifecycle.start.mutate()}>
                <Play className="size-4" /> Start
              </Button>
            )}
            {live && canEnd && (
              <Button variant="secondary" loading={lifecycle.end.isPending} onClick={() => lifecycle.end.mutate()}>
                <Square className="size-4" /> End meeting
              </Button>
            )}
            {canManage && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            {canManage && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 text-[13px]">
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="size-4 text-ink-faint" /> {formatMeetingWhen(meeting.scheduledStart, meeting.scheduledEnd)}
        </span>
        {meeting.location && (
          <span className="inline-flex items-center gap-2">
            <MapPin className="size-4 text-ink-faint" /> {meeting.location}
          </span>
        )}
        {meeting.team && (
          <Link href={`/teams/${meeting.team.id}`} className="text-brand hover:underline">
            {meeting.team.name}
          </Link>
        )}
        {meeting.event && (
          <Link href={`/events/${meeting.event.id}`} className="text-brand hover:underline">
            {meeting.event.name}
          </Link>
        )}
        {meeting.joinUrl && (
          <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
            Meeting link <ExternalLink className="size-3.5" />
          </a>
        )}
        {ended && meeting.startedAt && meeting.endedAt && (
          <span className="text-ink-soft">
            Ran {formatTime(meeting.startedAt)} – {formatTime(meeting.endedAt)}
          </span>
        )}
        {lifecycle.join.error && <ErrorNote>{errorMessage(lifecycle.join.error)}</ErrorNote>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {meeting.agenda && (
            <Card>
              <CardHeader title="Agenda" />
              <p className="px-5 py-4 text-sm whitespace-pre-wrap">{meeting.agenda}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="Meeting notes" description="What was discussed. Saved on the meeting record." />
            <div className="space-y-3 p-5">
              <Textarea
                className="min-h-32"
                value={notes ?? meeting.notes ?? ""}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={canManage ? "Type the notes as the meeting runs…" : "No notes yet"}
                disabled={!canManage}
              />
              {canManage && (
                <div className="flex items-center gap-3">
                  <Button size="sm" disabled={notes === null} loading={saveNotes.isPending} onClick={() => notes !== null && saveNotes.mutate(notes, { onSuccess: () => setNotes(null) })}>
                    Save notes
                  </Button>
                  {saveNotes.isSuccess && notes === null && <span className="text-[13px] text-ok">Saved</span>}
                  {saveNotes.error && <ErrorNote>{errorMessage(saveNotes.error)}</ErrorNote>}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={`Decisions (${meeting.decisions.length})`} description="The decision log — searchable organizational memory." />
            {meeting.decisions.length === 0 ? (
              <EmptyState icon={<Gavel className="size-6" />} title="No decisions recorded" />
            ) : (
              <ul className="divide-y divide-line">
                {meeting.decisions.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 px-5 py-3">
                    <Gavel className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{d.text}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">{d.decidedBy?.name ?? "Unknown"}</p>
                    </div>
                    {canManage && (
                      <Button size="sm" variant="ghost" aria-label="Remove decision" onClick={() => removeDecision.mutate(d.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <form
                className="flex flex-wrap gap-2 border-t border-line p-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  addDecision.mutate(decision, { onSuccess: () => setDecision("") });
                }}
              >
                <Input className="min-w-56 flex-1" required minLength={2} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Decision taken…" aria-label="New decision" />
                <Button type="submit" loading={addDecision.isPending}>
                  Record
                </Button>
              </form>
            )}
          </Card>

          <Card>
            <CardHeader title={`Action items (${meeting.actionItems.length})`} description="Each action with an owner becomes a task in their My Work." />
            {meeting.actionItems.length === 0 ? (
              <EmptyState icon={<CheckSquare className="size-6" />} title="No action items yet" />
            ) : (
              <ul className="divide-y divide-line">
                {meeting.actionItems.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <CheckSquare className="size-4 shrink-0 text-ink-faint" />
                    <div className="min-w-40 flex-1">
                      <p className="text-sm">{a.text}</p>
                      <p className="mt-0.5 text-xs text-ink-faint">{a.owner ? a.owner.name : "No owner"}</p>
                    </div>
                    {a.task ? (
                      <Link href={`/tasks/${a.task.id}`} className="text-[13px] text-brand hover:underline">
                        Task · {a.task.percentage}%
                      </Link>
                    ) : (
                      <Badge>No task</Badge>
                    )}
                    {canManage && (
                      <Button size="sm" variant="ghost" aria-label="Remove action item" onClick={() => removeAction.mutate(a.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <form
                className="grid gap-3 border-t border-line p-5 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  addAction.mutate(
                    {
                      text: action.text,
                      ownerId: action.ownerId || null,
                      dueDate: action.dueDate ? new Date(action.dueDate).toISOString() : null,
                      createTask: action.createTask,
                    },
                    { onSuccess: () => setAction({ text: "", ownerId: "", dueDate: "", createTask: true }) },
                  );
                }}
              >
                <Field label="Action" htmlFor="ai-text">
                  <Input id="ai-text" required minLength={2} value={action.text} onChange={(e) => setAction((a) => ({ ...a, text: e.target.value }))} placeholder="Send sponsor deck to vendor" />
                </Field>
                <Field label="Owner" htmlFor="ai-owner">
                  <Select id="ai-owner" value={action.ownerId} onChange={(e) => setAction((a) => ({ ...a, ownerId: e.target.value }))}>
                    <option value="">No owner</option>
                    {people.data
                      ?.filter((p) => p.status !== "DISABLED")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Due" htmlFor="ai-due">
                  <Input id="ai-due" type="date" value={action.dueDate} onChange={(e) => setAction((a) => ({ ...a, dueDate: e.target.value }))} />
                </Field>
                <Button type="submit" loading={addAction.isPending}>
                  Add
                </Button>
                <label className="flex items-center gap-2 text-[13px] sm:col-span-4">
                  <input type="checkbox" className="size-4 accent-brand" checked={action.createTask} onChange={(e) => setAction((a) => ({ ...a, createTask: e.target.checked }))} />
                  Also create a task for the owner
                </label>
                {addAction.error && (
                  <div className="sm:col-span-4">
                    <ErrorNote>{errorMessage(addAction.error)}</ErrorNote>
                  </div>
                )}
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`Participants (${meeting.participants.length})`}
              description={ended ? "Attendance from recorded join and leave times." : "Attendance builds as people join through TEAM OS."}
              action={
                canManage && can("user.view") ? (
                  <Button size="sm" variant="secondary" onClick={() => setAddingPerson(true)}>
                    <UserPlus className="size-3.5" /> Add
                  </Button>
                ) : undefined
              }
            />
            <ul className="divide-y divide-line">
              {meeting.participants.map((p) => (
                <li key={p.user.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={p.user.name} src={p.user.avatarUrl} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.user.name}</div>
                      <div className="text-xs text-ink-soft">
                        {p.role === "HOST" ? "Host · " : p.role === "CO_HOST" ? "Co-host · " : ""}
                        {p.minutes > 0 ? durationLabel(p.minutes) : "no time recorded"}
                        {p.firstJoinAt && ` · joined ${formatTime(p.firstJoinAt)}`}
                      </div>
                    </div>
                    <Badge tone={attendanceTone[p.status]}>
                      {attendanceLabel[p.status]}
                      {p.statusManual && " ·  set"}
                    </Badge>
                  </div>
                  {canMarkAttendance && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-10">
                      <Select
                        className="h-8 w-32 text-[13px]"
                        aria-label={`Attendance for ${p.user.name}`}
                        value={p.status}
                        onChange={(e) => override.mutate({ userId: p.user.id, status: e.target.value as AttendanceStatus })}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {attendanceLabel[s]}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="ghost" onClick={() => setSessionFor(p.user.id)}>
                        <Clock className="size-3.5" /> Add times
                      </Button>
                      {canManage && p.user.id !== meeting.createdById && (
                        <Button size="sm" variant="ghost" aria-label={`Remove ${p.user.name}`} onClick={() => removeParticipant.mutate(p.user.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {(override.error || removeParticipant.error) && (
              <div className="px-5 pb-4">
                <ErrorNote>{errorMessage(override.error ?? removeParticipant.error)}</ErrorNote>
              </div>
            )}
          </Card>

          {meeting.sessions.length > 0 && (
            <Card>
              <CardHeader title="Join & leave log" description="Every session, including rejoins." />
              <ul className="divide-y divide-line">
                {meeting.sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-5 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{s.user.name}</span>
                    <span className="text-ink-soft">
                      {formatTime(s.joinedAt)} – {s.leftAt ? formatTime(s.leftAt) : "still in"}
                    </span>
                    <Badge>{titleCase(s.source)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {editing && (
        <MeetingFormDialog
          mode="edit"
          open
          initial={meeting}
          onClose={() => {
            setEditing(false);
            update.reset();
          }}
          saving={update.isPending}
          error={update.error}
          onSave={(input) => update.mutate(input, { onSuccess: () => setEditing(false) })}
        />
      )}

      <Dialog
        open={addingPerson}
        onClose={() => {
          setAddingPerson(false);
          setParticipant.reset();
        }}
        title="Add participant"
        submitLabel="Add"
        submitting={setParticipant.isPending}
        error={setParticipant.error ? errorMessage(setParticipant.error) : null}
        onSubmit={() =>
          setParticipant.mutate(
            { userId: newPerson, role: "REQUIRED" },
            {
              onSuccess: () => {
                setAddingPerson(false);
                setNewPerson("");
              },
            },
          )
        }
      >
        <Field label="Person" htmlFor="mp-user">
          <Select id="mp-user" required value={newPerson} onChange={(e) => setNewPerson(e.target.value)}>
            <option value="">Select…</option>
            {people.data
              ?.filter((p) => !participantIds.has(p.id) && p.status !== "DISABLED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </Dialog>

      <Dialog
        open={!!sessionFor}
        onClose={() => {
          setSessionFor(null);
          addSession.reset();
        }}
        title="Record join and leave times"
        description="For physical meetings or when someone joined outside TEAM OS."
        submitLabel="Save times"
        submitting={addSession.isPending}
        error={addSession.error ? errorMessage(addSession.error) : null}
        onSubmit={() =>
          sessionFor &&
          addSession.mutate(
            {
              userId: sessionFor,
              joinedAt: new Date(session.joinedAt).toISOString(),
              leftAt: session.leftAt ? new Date(session.leftAt).toISOString() : null,
            },
            {
              onSuccess: () => {
                setSessionFor(null);
                setSession({ joinedAt: "", leftAt: "" });
              },
            },
          )
        }
      >
        <Field label="Joined at" htmlFor="ses-join">
          <Input id="ses-join" type="datetime-local" required value={session.joinedAt} onChange={(e) => setSession((s) => ({ ...s, joinedAt: e.target.value }))} />
        </Field>
        <Field label="Left at" htmlFor="ses-leave" hint="Leave empty if they stayed to the end.">
          <Input id="ses-leave" type="datetime-local" min={session.joinedAt} value={session.leftAt} onChange={(e) => setSession((s) => ({ ...s, leftAt: e.target.value }))} />
        </Field>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${meeting.title}"?`}
        description="The meeting, its attendance, notes, decisions and action items are removed. Tasks already created stay."
        submitLabel="Delete meeting"
        submitVariant="danger"
        submitting={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onSubmit={() => remove.mutate(id, { onSuccess: () => router.replace("/meetings") })}
      >
        <p className="text-sm text-ink-soft">To keep the record, edit the meeting and set its status to Cancelled.</p>
      </Dialog>
    </>
  );
}

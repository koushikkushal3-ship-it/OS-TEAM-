"use client";

import { ArrowLeft, CheckCircle2, MessageSquarePlus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ProgressBar, TaskList } from "@/components/tasks/task-bits";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { WorkUpdateDialog } from "@/components/tasks/work-update-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, PageHeader, Spinner, Textarea } from "@/components/ui/primitives";
import { useDeleteTask, useReviewWorkUpdate, useTask, useUpdateTask } from "@/features/tasks/api";
import { errorMessage } from "@/lib/api/client";
import { dueLabel, formatDate, formatDateTime, priorityTone, taskStatusLabel, taskStatusTone, titleCase } from "@/lib/format";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading, error } = useTask(id);
  const update = useUpdateTask(id);
  const remove = useDeleteTask();
  const review = useReviewWorkUpdate(id);

  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [changesFor, setChangesFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  if (isLoading) return <Spinner />;
  if (error || !task) return <ErrorNote>{errorMessage(error)}</ErrorNote>;

  const { canUpdate, canSubmitUpdate, canReview, canDelete } = task.capabilities;
  const due = dueLabel(task.dueDate);
  const pendingReview = task.updates.find((u) => !u.reviewedAt && u.status === "IN_REVIEW");

  return (
    <>
      <Link href="/work" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
        <ArrowLeft className="size-3.5" /> My Work
      </Link>

      <PageHeader
        eyebrow={
          task.parentTask ? (
            <Link href={`/tasks/${task.parentTask.id}`} className="hover:underline">
              Subtask of {task.parentTask.title}
            </Link>
          ) : (
            "Task"
          )
        }
        title={task.title}
        description={task.description ?? undefined}
        actions={
          <>
            {canSubmitUpdate && (
              <Button onClick={() => setPosting(true)}>
                <MessageSquarePlus className="size-4" /> Post update
              </Button>
            )}
            {canUpdate && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={taskStatusTone[task.status]}>{taskStatusLabel[task.status]}</Badge>
          <Badge tone={priorityTone[task.priority]}>{titleCase(task.priority)} priority</Badge>
          {task.team && (
            <Link href={`/teams/${task.team.id}`} className="text-[13px] text-brand hover:underline">
              {task.team.name}
            </Link>
          )}
          {task.event && (
            <Link href={`/events/${task.event.id}`} className="text-[13px] text-brand hover:underline">
              {task.event.name}
            </Link>
          )}
          <span className={`ml-auto text-[13px] ${due.tone === "danger" ? "text-danger" : due.tone === "warn" ? "text-warn" : "text-ink-soft"}`}>{due.text}</span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-soft">Progress</span>
            <span className="text-lg font-semibold tabular-nums">{task.percentage}%</span>
          </div>
          <ProgressBar value={task.percentage} tone={task.status === "COMPLETED" ? "ok" : "brand"} className="mt-1.5" />
        </div>

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-faint">Assigned to</dt>
            <dd className="mt-1 flex items-center gap-2">
              {task.assignedTo ? (
                <>
                  <Avatar name={task.assignedTo.name} src={task.assignedTo.avatarUrl} size={22} /> {task.assignedTo.name}
                </>
              ) : (
                <span className="text-ink-faint">Unassigned</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Created by</dt>
            <dd className="mt-1">{task.createdBy?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Start</dt>
            <dd className="mt-1">{formatDate(task.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Completed</dt>
            <dd className="mt-1">{task.completedAt ? formatDate(task.completedAt) : "—"}</dd>
          </div>
        </dl>
      </Card>

      {canReview && pendingReview && (
        <Card className="mb-6 border-warn/30 bg-warn-soft/40">
          <CardHeader title="Waiting for your review" description={`${pendingReview.user?.name ?? "Someone"} reported 100% — accept to complete the task, or send it back.`} />
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            <Button
              loading={review.isPending && review.variables?.decision === "ACCEPT"}
              onClick={() => review.mutate({ updateId: pendingReview.id, decision: "ACCEPT" })}
            >
              <CheckCircle2 className="size-4" /> Accept & complete
            </Button>
            <Button variant="secondary" onClick={() => setChangesFor(pendingReview.id)}>
              <RotateCcw className="size-4" /> Request changes
            </Button>
          </div>
          {review.error && (
            <div className="px-5 pb-5">
              <ErrorNote>{errorMessage(review.error)}</ErrorNote>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`Work history (${task.updates.length})`} description="Every update stays on the record." />
          {task.updates.length === 0 ? (
            <EmptyState title="No updates yet" description={canSubmitUpdate ? "Post the first daily update." : undefined} />
          ) : (
            <ol className="divide-y divide-line">
              {task.updates.map((u) => (
                <li key={u.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {u.user && <Avatar name={u.user.name} src={u.user.avatarUrl} size={24} />}
                    <span className="text-sm font-medium">{u.user?.name ?? "Unknown"}</span>
                    <Badge tone={taskStatusTone[u.status]}>{taskStatusLabel[u.status]}</Badge>
                    <span className="text-sm font-semibold tabular-nums">{u.percentage}%</span>
                    <span className="ml-auto text-xs text-ink-faint">{formatDateTime(u.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{u.summary}</p>
                  {u.blockers && (
                    <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger whitespace-pre-wrap">
                      <span className="font-medium">Blocker:</span> {u.blockers}
                    </p>
                  )}
                  {u.reviewedAt && (
                    <p className="mt-2 text-xs text-ink-soft">
                      Reviewed by {u.reviewedBy?.name ?? "lead"} · {formatDateTime(u.reviewedAt)}
                      {u.reviewNote ? ` — ${u.reviewNote}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader title={`Subtasks (${task.subtasks.length})`} />
          <TaskList tasks={task.subtasks} empty="No subtasks" showTeam={false} />
        </Card>
      </div>

      {editing && (
        <TaskFormDialog
          mode="edit"
          open
          initial={task}
          onClose={() => {
            setEditing(false);
            update.reset();
          }}
          saving={update.isPending}
          error={update.error}
          onSave={(input) => update.mutate(input, { onSuccess: () => setEditing(false) })}
        />
      )}

      <WorkUpdateDialog task={task} open={posting} onClose={() => setPosting(false)} />

      <Dialog
        open={!!changesFor}
        onClose={() => setChangesFor(null)}
        title="Request changes"
        description="The task goes back to In progress with your note attached."
        submitLabel="Send back"
        submitting={review.isPending}
        error={review.error ? errorMessage(review.error) : null}
        onSubmit={() =>
          changesFor &&
          review.mutate(
            { updateId: changesFor, decision: "CHANGES_REQUESTED", note: note || undefined },
            {
              onSuccess: () => {
                setChangesFor(null);
                setNote("");
              },
            },
          )
        }
      >
        <Field label="What needs changing?" htmlFor="review-note">
          <Textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${task.title}"?`}
        description="The task and its work history are removed permanently. This is recorded in the audit log."
        submitLabel="Delete task"
        submitVariant="danger"
        submitting={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onSubmit={() => remove.mutate(id, { onSuccess: () => router.replace("/work") })}
      >
        <p className="text-sm text-ink-soft">To keep the record, set the status to Cancelled instead.</p>
      </Dialog>
    </>
  );
}

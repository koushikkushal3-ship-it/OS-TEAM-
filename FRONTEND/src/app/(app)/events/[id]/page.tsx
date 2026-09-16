"use client";

import { ArrowLeft, CalendarRange, MapPin, Pencil, Settings2, Trash2, UserRound, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { EventFormDialog } from "@/components/events/event-form-dialog";
import { MeetingSection } from "@/components/meetings/meeting-section";
import { BudgetHealthSection, DuplicateEventButton, RunOfShowSection, ShiftsSection } from "@/components/platform/event-ops";
import { useCan } from "@/lib/permissions/can";
import { TaskSection } from "@/components/tasks/task-section";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { useDeleteEvent, useEvent, useSetEventTeams, useUpdateEvent } from "@/features/events/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import { eventStatusTone, formatDateRange, formatMoney, memberRoleLabel, titleCase } from "@/lib/format";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: event, isLoading, error } = useEvent(id);
  const update = useUpdateEvent(id);
  const setTeams = useSetEventTeams(id);
  const remove = useDeleteEvent();
  const allTeams = useTeams();
  const can = useCan();

  const [editing, setEditing] = useState(false);
  const [managingTeams, setManagingTeams] = useState(false);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) return <Spinner />;
  if (error || !event) return <ErrorNote>{errorMessage(error)}</ErrorNote>;

  const { canUpdate, canManageTeams, canDelete } = event.capabilities;

  return (
    <>
      <Link href="/events" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
        <ArrowLeft className="size-3.5" /> Events
      </Link>
      <PageHeader
        eyebrow="Event workspace"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {event.name} <Badge tone={eventStatusTone[event.status]}>{titleCase(event.status)}</Badge>
          </span>
        }
        description={event.description ?? undefined}
        actions={
          <>
            {can("event.create") && <DuplicateEventButton eventId={id} name={event.name} startDate={event.startDate} />}
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

      <Card className="mb-6 grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        {[
          { icon: CalendarRange, label: "Dates", value: formatDateRange(event.startDate, event.endDate) },
          { icon: MapPin, label: "Venue", value: event.venue ?? "—" },
          { icon: UserRound, label: "Owner", value: event.owner?.name ?? "—" },
          { icon: Wallet, label: "Budget", value: event.budget != null ? formatMoney(event.budget) : "Restricted" },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 px-5 py-4">
            <Icon className="size-4 text-ink-faint" />
            <div className="min-w-0">
              <div className="text-xs text-ink-faint">{label}</div>
              <div className="truncate text-sm font-medium">{value}</div>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`Teams (${event.teams.length})`}
            description="Each team has its own workspace for this event."
            action={
              canManageTeams ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSelectedTeams(event.teams.map((t) => t.team.id));
                    setManagingTeams(true);
                  }}
                >
                  <Settings2 className="size-3.5" /> Manage teams
                </Button>
              ) : undefined
            }
          />
          {event.teams.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="No teams assigned" />
          ) : (
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {event.teams.map(({ team }) => (
                <Link key={team.id} href={`/teams/${team.id}`} className="rounded-lg border border-line p-4 hover:border-line-strong hover:bg-subtle">
                  <div className="font-medium">{team.name}</div>
                  <div className="mt-2 space-y-1">
                    {team.members.length === 0 ? (
                      <div className="text-xs text-ink-faint">No lead assigned</div>
                    ) : (
                      team.members.map((m) => (
                        <div key={m.user.id} className="flex items-center gap-2 text-xs text-ink-soft">
                          <Badge tone="brand">{memberRoleLabel[m.memberRole]}</Badge> {m.user.name}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-3 text-xs text-ink-faint">{team._count.members} members</div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Event members" description="People attached directly to this event" />
          {event.members.length === 0 ? (
            <EmptyState title="No direct members" description="Team members work on the event through their teams." />
          ) : (
            <ul className="divide-y divide-line">
              {event.members.map((m) => (
                <li key={m.user.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.user.name}</div>
                    {m.role && <div className="text-xs text-ink-soft">{m.role}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TaskSection eventId={id} title="Event work" />
      <MeetingSection eventId={id} title="Event meetings" />

      <RunOfShowSection eventId={id} />
      <ShiftsSection eventId={id} />
      <BudgetHealthSection eventId={id} />

      {editing && (
        <EventFormDialog
          mode="edit"
          open
          initial={event}
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
        open={managingTeams}
        onClose={() => {
          setManagingTeams(false);
          setTeams.reset();
        }}
        title="Teams on this event"
        description="Adding a team gives it a workspace for this event. Changes are audited."
        submitLabel="Save teams"
        submitting={setTeams.isPending}
        error={setTeams.error ? errorMessage(setTeams.error) : null}
        onSubmit={() => setTeams.mutate(selectedTeams, { onSuccess: () => setManagingTeams(false) })}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {allTeams.data?.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm has-checked:border-brand has-checked:bg-brand-soft">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={selectedTeams.includes(t.id)}
                onChange={() =>
                  setSelectedTeams((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))
                }
              />
              {t.name}
            </label>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${event.name}?`}
        description="The event and its team links will be removed permanently. This is recorded in the audit log."
        submitLabel="Delete event"
        submitVariant="danger"
        submitting={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onSubmit={() => remove.mutate(id, { onSuccess: () => router.replace("/events") })}
      >
        <p className="text-sm text-ink-soft">To keep the history, set the status to Archived instead.</p>
      </Dialog>
    </>
  );
}

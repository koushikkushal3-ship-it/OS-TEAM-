"use client";

import { ArrowLeft, CalendarRange, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { MeetingSection } from "@/components/meetings/meeting-section";
import { TaskSection } from "@/components/tasks/task-section";
import { TeamFormDialog } from "@/components/teams/team-form-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, PageHeader, Select, Spinner } from "@/components/ui/primitives";
import { usePeople } from "@/features/people/api";
import { useDeleteTeam, useRemoveTeamMember, useSetTeamMember, useTeam, useUpdateTeam } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { TeamMemberRole } from "@/lib/api/types";
import { eventStatusTone, formatDate, formatDateRange, memberRoleLabel, titleCase } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const { data: team, isLoading, error } = useTeam(id);
  const update = useUpdateTeam(id);
  const remove = useDeleteTeam();
  const setMember = useSetTeamMember(id);
  const removeMember = useRemoveTeamMember(id);

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newMember, setNewMember] = useState<{ userId: string; memberRole: TeamMemberRole }>({ userId: "", memberRole: "MEMBER" });
  const people = usePeople({}, adding && can("user.view"));

  if (isLoading) return <Spinner />;
  if (error || !team) return <ErrorNote>{errorMessage(error)}</ErrorNote>;

  const { canUpdate, canManageMembers, canRemove } = team.capabilities;
  const memberIds = new Set(team.members.map((m) => m.user.id));

  return (
    <>
      <Link href="/teams" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
        <ArrowLeft className="size-3.5" /> Teams
      </Link>
      <PageHeader
        eyebrow={team.department?.name ?? "Team workspace"}
        title={
          <span className="flex items-center gap-3">
            {team.name} {!team.isActive && <Badge>Inactive</Badge>}
          </span>
        }
        description={team.description ?? undefined}
        actions={
          <>
            {canUpdate && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            {canRemove && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Remove
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`Members (${team.members.length})`}
            description="Leads and co-leads run the team workspace."
            action={
              canManageMembers && can("user.view") ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <UserPlus className="size-3.5" /> Add member
                </Button>
              ) : undefined
            }
          />
          {team.members.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="No members yet" />
          ) : (
            <ul className="divide-y divide-line">
              {team.members.map((m) => (
                <li key={m.user.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar name={m.user.name} src={m.user.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.user.name}</div>
                    <div className="truncate text-xs text-ink-soft">
                      {m.user.email} · joined {formatDate(m.joinedAt)}
                    </div>
                  </div>
                  {m.user.status !== "ACTIVE" && <Badge tone={m.user.status === "INVITED" ? "warn" : "danger"}>{titleCase(m.user.status)}</Badge>}
                  {canManageMembers ? (
                    <>
                      <Select
                        aria-label={`Team role for ${m.user.name}`}
                        className="h-8 w-28 text-[13px]"
                        value={m.memberRole}
                        onChange={(e) => setMember.mutate({ userId: m.user.id, memberRole: e.target.value as TeamMemberRole })}
                      >
                        {(Object.keys(memberRoleLabel) as TeamMemberRole[]).map((r) => (
                          <option key={r} value={r}>
                            {memberRoleLabel[r]}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${m.user.name}`} onClick={() => removeMember.mutate(m.user.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Badge tone={m.memberRole === "MEMBER" ? "neutral" : "brand"}>{memberRoleLabel[m.memberRole]}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {(setMember.error || removeMember.error) && (
            <div className="px-5 pb-4">
              <ErrorNote>{errorMessage(setMember.error ?? removeMember.error)}</ErrorNote>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Events" description="Events this team is working on" />
          {team.events.length === 0 ? (
            <EmptyState icon={<CalendarRange className="size-6" />} title="Not on any event yet" />
          ) : (
            <ul className="divide-y divide-line">
              {team.events.map(({ event }) => (
                <li key={event.id}>
                  <Link href={`/events/${event.id}`} className="block px-5 py-3 hover:bg-subtle">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{event.name}</span>
                      <Badge tone={eventStatusTone[event.status]}>{titleCase(event.status)}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-soft">{formatDateRange(event.startDate, event.endDate)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TaskSection teamId={id} title="Team work" />
      <MeetingSection teamId={id} title="Team meetings" />

      {editing && (
        <TeamFormDialog
          mode="edit"
          open
          initial={{ name: team.name, description: team.description, departmentId: team.department?.id, isActive: team.isActive }}
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
        open={adding}
        onClose={() => {
          setAdding(false);
          setMember.reset();
        }}
        title="Add member"
        submitLabel="Add to team"
        submitting={setMember.isPending}
        error={setMember.error ? errorMessage(setMember.error) : null}
        onSubmit={() =>
          setMember.mutate(newMember, {
            onSuccess: () => {
              setAdding(false);
              setNewMember({ userId: "", memberRole: "MEMBER" });
            },
          })
        }
      >
        <Field label="Person" htmlFor="member-user">
          <Select id="member-user" required value={newMember.userId} onChange={(e) => setNewMember((m) => ({ ...m, userId: e.target.value }))}>
            <option value="">Select a person…</option>
            {people.data
              ?.filter((p) => !memberIds.has(p.id) && p.status !== "DISABLED")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.email}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Team role" htmlFor="member-role">
          <Select id="member-role" value={newMember.memberRole} onChange={(e) => setNewMember((m) => ({ ...m, memberRole: e.target.value as TeamMemberRole }))}>
            {(Object.keys(memberRoleLabel) as TeamMemberRole[]).map((r) => (
              <option key={r} value={r}>
                {memberRoleLabel[r]}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${team.name}?`}
        description="Memberships and event links for this team will be removed. This is recorded in the audit log."
        submitLabel="Remove team"
        submitVariant="danger"
        submitting={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onSubmit={() => remove.mutate(id, { onSuccess: () => router.replace("/teams") })}
      >
        <p className="text-sm text-ink-soft">To keep history instead, edit the team and mark it inactive.</p>
      </Dialog>
    </>
  );
}

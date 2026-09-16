"use client";

import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TeamFormDialog } from "@/components/teams/team-form-dialog";
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { useCreateTeam, useTeams } from "@/features/teams/api";
import { memberRoleLabel } from "@/lib/format";
import { Can } from "@/lib/permissions/can";

export default function TeamsPage() {
  const { data: teams, isLoading } = useTeams();
  const create = useCreateTeam();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="02 · Teams & Events"
        title="Teams"
        description="Every team, its leads and the events it works on."
        actions={
          <Can permission="team.create">
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New team
            </Button>
          </Can>
        }
      />

      {isLoading ? (
        <Spinner />
      ) : !teams?.length ? (
        <Card>
          <EmptyState icon={<Users className="size-6" />} title="No teams yet" description="Teams you belong to or can view will appear here." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <Link key={team.id} href={`/teams/${team.id}`} className="group">
              <Card className="flex h-full flex-col p-5 transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-ink group-hover:text-brand">{team.name}</h2>
                    <p className="mt-0.5 text-xs text-ink-faint">{team.department?.name ?? "No department"}</p>
                  </div>
                  <div className="flex gap-1">
                    {team.isMember && <Badge tone="brand">Your team</Badge>}
                    {!team.isActive && <Badge>Inactive</Badge>}
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 flex-1 text-[13px] text-ink-soft">{team.description || "No description yet."}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <div className="flex -space-x-2">
                    {team.members.slice(0, 3).map((m) => (
                      <span key={m.user.id} title={`${m.user.name} · ${memberRoleLabel[m.memberRole]}`} className="rounded-full ring-2 ring-surface">
                        <Avatar name={m.user.name} src={m.user.avatarUrl} size={26} />
                      </span>
                    ))}
                    {team.members.length === 0 && <span className="text-xs text-ink-faint">No lead assigned</span>}
                  </div>
                  <span className="text-xs text-ink-soft">
                    {team._count.members} members · {team._count.events} events
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <TeamFormDialog
        key={open ? "open" : "closed"}
        mode="create"
        open={open}
        onClose={() => {
          setOpen(false);
          create.reset();
        }}
        saving={create.isPending}
        error={create.error}
        onSave={(input) =>
          create.mutate(input, {
            onSuccess: (team) => {
              setOpen(false);
              router.push(`/teams/${team.id}`);
            },
          })
        }
      />
    </>
  );
}

"use client";

import { Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar, Badge, Button, Card, EmptyState, ErrorNote, Input, Select, Spinner } from "@/components/ui/primitives";
import { usePeople, useSetPersonEnabled } from "@/features/people/api";
import { errorMessage } from "@/lib/api/client";
import type { Person, UserStatus } from "@/lib/api/types";
import { formatDate, memberRoleLabel, titleCase, userStatusTone } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

/** Shared people directory — used in the workspace and (with extra actions) in the Master console. */
export function PeopleTable({ renderActions, showMasterRoles = false, headerAction }: { renderActions?: (p: Person) => ReactNode; showMasterRoles?: boolean; headerAction?: ReactNode }) {
  const can = useCan();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const { data: people, isLoading } = usePeople({ search, status });
  const setEnabled = useSetPersonEnabled();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <Input className="pl-9" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
        </div>
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value as UserStatus | "")} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INVITED">Invited</option>
          <option value="DISABLED">Disabled</option>
        </Select>
        {headerAction}
      </div>

      {setEnabled.error && (
        <div className="mb-3">
          <ErrorNote>{errorMessage(setEnabled.error)}</ErrorNote>
        </div>
      )}

      <Card className="overflow-x-auto">
        {isLoading ? (
          <Spinner />
        ) : !people?.length ? (
          <EmptyState title="No people match" />
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-subtle text-xs text-ink-soft">
              <tr>
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Roles</th>
                <th className="px-3 py-2.5 font-medium">Teams</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Last sign-in</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={p.name} src={p.avatarUrl} />
                      <div className="min-w-0">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-ink-soft">{p.email}</div>
                        {p.department && <div className="text-xs text-ink-faint">{p.department.name}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {p.roles
                        .filter((r) => showMasterRoles || !r.role.isMasterAdmin)
                        .map((r) => (
                          <Badge key={r.id} tone={r.role.isMasterAdmin ? "master" : "neutral"}>
                            {r.role.name}
                            {r.scopeType !== "ORGANIZATION" && <span className="opacity-60">· {titleCase(r.scopeType)}</span>}
                          </Badge>
                        ))}
                      {p.roles.length === 0 && <span className="text-xs text-ink-faint">No roles</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">
                    {p.teamMemberships.map((m) => `${m.team.name}${m.memberRole !== "MEMBER" ? ` (${memberRoleLabel[m.memberRole]})` : ""}`).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={userStatusTone[p.status]}>{titleCase(p.status)}</Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{formatDate(p.lastLoginAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1.5">
                      {renderActions?.(p)}
                      {can("user.disable") && (
                        <Button
                          size="sm"
                          variant={p.status === "DISABLED" ? "secondary" : "ghost"}
                          loading={setEnabled.isPending && setEnabled.variables?.id === p.id}
                          onClick={() => setEnabled.mutate({ id: p.id, enabled: p.status === "DISABLED" })}
                        >
                          {p.status === "DISABLED" ? "Enable" : "Disable"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

    </>
  );
}

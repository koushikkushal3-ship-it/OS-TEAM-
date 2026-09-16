"use client";

import { Eye, EyeOff, LogOut, ShieldPlus, Upload, UserMinus, X } from "lucide-react";
import { useState } from "react";
import { PeopleTable } from "@/components/admin/people-table";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, ErrorNote, Field, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { isPendingApproval, useControl, useViewAs } from "@/features/platform/api";
import {
  type AccessPreset,
  useApplyPreset,
  useAssignRole,
  usePersonAccess,
  useRemoveRole,
  useRoles,
} from "@/features/administration/api";
import { useEvents } from "@/features/events/api";
import { useDepartments, usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { Person, RoleScope } from "@/lib/api/types";
import { formatDateTime, titleCase } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

function RolesDialog({ personId, onClose }: { personId: string; onClose: () => void }) {
  const people = usePeople();
  const person = people.data?.find((p) => p.id === personId);
  const roles = useRoles();
  const teams = useTeams();
  const events = useEvents();
  const departments = useDepartments();
  const assign = useAssignRole();
  const removeRole = useRemoveRole();
  const [form, setForm] = useState<{ roleId: string; scopeType: RoleScope; scopeId: string }>({ roleId: "", scopeType: "ORGANIZATION", scopeId: "" });
  const [pending, setPending] = useState(false);

  const scopeOptions =
    form.scopeType === "TEAM" ? teams.data : form.scopeType === "EVENT" ? events.data : form.scopeType === "DEPARTMENT" ? departments.data : [];
  const scopeName = (type: RoleScope, id: string | null) => {
    if (!id) return null;
    const list = type === "TEAM" ? teams.data : type === "EVENT" ? events.data : departments.data;
    return list?.find((x) => x.id === id)?.name ?? "…";
  };

  if (!person) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Roles · ${person.name}`}
      description="Roles can apply to the whole organization or only inside one department, team or event."
      submitLabel="Assign role"
      submitting={assign.isPending}
      error={assign.error || removeRole.error ? errorMessage(assign.error ?? removeRole.error) : null}
      onSubmit={() =>
        assign.mutate(
          { userId: person.id, roleId: form.roleId, scopeType: form.scopeType, scopeId: form.scopeType === "ORGANIZATION" ? null : form.scopeId },
          {
            onSuccess: (result) => {
              setPending(isPendingApproval(result));
              setForm({ roleId: "", scopeType: "ORGANIZATION", scopeId: "" });
            },
          },
        )
      }
    >
      {pending && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Sent for approval: another Master Admin must approve this in Approvals before it takes effect.
        </p>
      )}
      <div>
        <div className="mb-2 text-[13px] font-medium">Current roles</div>
        <div className="flex flex-wrap gap-2">
          {person.roles.length === 0 && <span className="text-sm text-ink-faint">No roles yet</span>}
          {person.roles.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-subtle py-1 pr-1 pl-2.5 text-[13px]">
              {r.role.isMasterAdmin && <Badge tone="master">Master</Badge>}
              {r.role.name}
              {r.scopeType !== "ORGANIZATION" && (
                <span className="text-ink-faint">
                  · {titleCase(r.scopeType)}: {scopeName(r.scopeType, r.scopeId)}
                </span>
              )}
              <button
                type="button"
                className="rounded p-0.5 text-ink-faint hover:bg-line hover:text-danger"
                aria-label={`Remove ${r.role.name}`}
                onClick={() => removeRole.mutate({ userId: person.id, assignmentId: r.id })}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Role" htmlFor="ra-role">
            <Select id="ra-role" required value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
              <option value="">Select a role…</option>
              {roles.data
                ?.filter((r) => r.isActive)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.department ? ` — ${r.department.name}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Field label="Applies to" htmlFor="ra-scope">
          <Select id="ra-scope" value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as RoleScope, scopeId: "" }))}>
            <option value="ORGANIZATION">Whole organization</option>
            <option value="DEPARTMENT">One department</option>
            <option value="TEAM">One team</option>
            <option value="EVENT">One event</option>
          </Select>
        </Field>
        {form.scopeType !== "ORGANIZATION" && (
          <Field label={titleCase(form.scopeType)} htmlFor="ra-scope-id">
            <Select id="ra-scope-id" required value={form.scopeId} onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}>
              <option value="">Select…</option>
              {scopeOptions?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}

const ACCESS_LABEL: Record<AccessPreset, string> = {
  DEFAULT: "As their roles allow",
  DENIED: "Hidden",
  VIEW_ONLY: "View only",
  FULL: "Full access",
};

/**
 * Per-person menu control. Each choice is saved as USER-level overrides through the
 * same preset endpoint the Permissions page uses, so there is still one permission system —
 * this is only a friendlier door into it.
 */
function AccessDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const access = usePersonAccess(person.id);
  const apply = useApplyPreset();
  const rows = access.data?.filter((m) => m.key !== "administration") ?? [];
  const [until, setUntil] = useState("");

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Access · ${person.name}`}
      description="Hide a menu item from this person only, or give them more than their roles do. Everyone else is unaffected. Changes save immediately."
      error={apply.error ? errorMessage(apply.error) : null}
    >
      <Field label="Temporary until (optional)" htmlFor="ac-until" hint="Set a date first, then change a module: that access switches off by itself at this moment. Leave empty for permanent.">
        <Input id="ac-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className="max-w-xs" />
      </Field>
      {access.isLoading ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((m) => {
            const saving = apply.isPending && apply.variables?.moduleKey === m.key;
            return (
              <li key={m.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-40 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {m.name}
                    {m.preset === "DENIED" && <Badge tone="danger">Hidden</Badge>}
                    {m.expiresAt && <Badge tone="warn">until {formatDateTime(m.expiresAt)}</Badge>}
                  </div>
                  {m.description && <div className="text-xs text-ink-soft">{m.description}</div>}
                </div>
                {m.isCore ? (
                  <span className="text-xs text-ink-faint">Always available</span>
                ) : (
                  <Select
                    className="w-48"
                    aria-label={`${m.name} access for ${person.name}`}
                    value={m.preset}
                    disabled={saving}
                    onChange={(e) =>
                      apply.mutate({ scopeType: "USER", scopeId: person.id, moduleKey: m.key, preset: e.target.value as AccessPreset, expiresAt: until ? new Date(until).toISOString() : null })
                    }
                  >
                    {m.preset === "CUSTOM" && (
                      <option value="CUSTOM" disabled>
                        Custom — see Permissions
                      </option>
                    )}
                    {(Object.keys(ACCESS_LABEL) as AccessPreset[])
                      .filter((p) => p !== "VIEW_ONLY" || m.canViewOnly)
                      .map((p) => (
                        <option key={p} value={p}>
                          {ACCESS_LABEL[p]}
                        </option>
                      ))}
                  </Select>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

function OffboardDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { offboard } = useControl();
  const people = usePeople({ status: "ACTIVE" });
  const [heir, setHeir] = useState("");
  const result = offboard.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Offboard ${person.name}`}
      description="Disables the account, signs them out everywhere, hands open tasks, tickets, events and records to someone else, removes future shifts and team memberships, and cancels pending leave. History stays."
      submitLabel={result ? undefined : "Offboard"}
      submitVariant="danger"
      submitting={offboard.isPending}
      error={offboard.error ? errorMessage(offboard.error) : null}
      onSubmit={result ? undefined : () => offboard.mutate({ id: person.id, reassignToId: heir || null })}
    >
      {result ? (
        <p className="text-sm">
          Done. Handed over {result.tasks} task(s), {result.tickets} ticket(s), {result.events} event(s), {result.opportunities} opportunity(ies) and {result.records} record(s); removed {result.futureShifts} future shift(s) and {result.teams} team membership(s); ended {result.sessions} session(s).
        </p>
      ) : (
        <Field label="Hand open work to" htmlFor="ob-heir" hint="Leave empty to unassign it instead.">
          <Select id="ob-heir" value={heir} onChange={(e) => setHeir(e.target.value)}>
            <option value="">Nobody — unassign</option>
            {people.data
              ?.filter((p) => p.id !== person.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

function BulkInviteDialog({ onClose }: { onClose: () => void }) {
  const { bulkInvite } = useControl();
  const [csv, setCsv] = useState("email,name,department,role\n");
  const result = bulkInvite.data;
  const checked = result?.dryRun;
  const finished = result && !checked;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Invite many people"
      description="Paste rows from Google Sheets or a CSV: email, name, department, role. Department and role must match names in TEAM OS; Master Admin cannot be given this way. While Google sign-in is in Testing, each person must also be added as a Google test user."
      submitLabel={finished ? undefined : checked ? `Invite ${result?.ready ?? 0} people` : "Check the list"}
      submitting={bulkInvite.isPending}
      error={bulkInvite.error ? errorMessage(bulkInvite.error) : null}
      onSubmit={finished ? undefined : () => bulkInvite.mutate({ csv, dryRun: !checked })}
    >
      <Textarea
        className="min-h-48 font-mono text-xs"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          bulkInvite.reset();
        }}
        aria-label="People to invite"
      />
      {result && (
        <div className="space-y-2 text-sm">
          {checked ? <p>{result.ready} ready to invite.</p> : <p className="font-medium text-ok">Invited {result.created} people.</p>}
          {result.problems.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2 text-xs">
              {result.problems.map((p, i) => (
                <li key={i}>
                  <span className="font-mono text-ink-faint">line {p.line}</span> {p.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function MasterPeoplePage() {
  const [selected, setSelected] = useState<Person | null>(null);
  const [accessFor, setAccessFor] = useState<Person | null>(null);
  const [offboarding, setOffboarding] = useState<Person | null>(null);
  const [bulk, setBulk] = useState(false);
  const viewAs = useViewAs();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { signOut } = useControl();
  const actionError = viewAs.error ?? signOut.error;
  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="People"
        description="Invite people, assign and scope their roles, and grant or revoke Master Admin."
        actions={
          <Button variant="secondary" onClick={() => setBulk(true)}>
            <Upload className="size-4" /> Invite many
          </Button>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(actionError)}</ErrorNote>
        </div>
      )}
      {signOut.data && <p className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">Signed out of {signOut.data.sessions} session(s).</p>}
      <PeopleTable
        showMasterRoles
        renderActions={(p) => (
          <>
            <Button size="sm" variant="secondary" onClick={() => setSelected(p)}>
              <ShieldPlus className="size-3.5" /> Roles
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAccessFor(p)}>
              <EyeOff className="size-3.5" /> Access
            </Button>
            {p.status !== "DISABLED" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  title="See the portal exactly as this person does (read-only)"
                  loading={viewAs.isPending && viewAs.variables === p.id}
                  onClick={() => viewAs.mutate(p.id, { onSuccess: () => { queryClient.clear(); router.push("/dashboard"); } })}
                >
                  <Eye className="size-3.5" /> View as
                </Button>
                <Button size="sm" variant="ghost" title="Sign out everywhere" aria-label={`Sign ${p.name} out everywhere`} onClick={() => confirm(`Sign ${p.name} out of every device?`) && signOut.mutate(p.id)}>
                  <LogOut className="size-3.5" />
                </Button>
                <Button size="sm" variant="ghost" title="Offboard" aria-label={`Offboard ${p.name}`} onClick={() => setOffboarding(p)}>
                  <UserMinus className="size-3.5" />
                </Button>
              </>
            )}
          </>
        )}
      />
      {selected && <RolesDialog key={selected.id} personId={selected.id} onClose={() => setSelected(null)} />}
      {accessFor && <AccessDialog key={accessFor.id} person={accessFor} onClose={() => setAccessFor(null)} />}
      {offboarding && <OffboardDialog key={offboarding.id} person={offboarding} onClose={() => setOffboarding(null)} />}
      {bulk && <BulkInviteDialog onClose={() => setBulk(false)} />}
    </>
  );
}

"use client";

import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner } from "@/components/ui/primitives";
import {
  type AccessPreset,
  useApplyPreset,
  useDeleteOverride,
  useExplain,
  useOverrides,
  usePermissionCatalog,
  useRoles,
  useSaveOverride,
} from "@/features/administration/api";
import { useEvents } from "@/features/events/api";
import { useDepartments, usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { CatalogModule, OverrideScope, PermissionOverride } from "@/lib/api/types";
import { titleCase } from "@/lib/format";

const PRESETS: { value: AccessPreset; label: string }[] = [
  { value: "DEFAULT", label: "Role default" },
  { value: "DENIED", label: "Denied" },
  { value: "VIEW_ONLY", label: "View only" },
  { value: "FULL", label: "Full access" },
];

const SCOPES: OverrideScope[] = ["GLOBAL", "ORGANIZATION", "DEPARTMENT", "TEAM", "EVENT", "ROLE", "USER"];

function detectPreset(rows: PermissionOverride[], catalogModule: CatalogModule): AccessPreset | "CUSTOM" {
  const prefix = catalogModule.permissions[0]?.key.split(".")[0];
  const keys = new Set(catalogModule.permissions.map((p) => p.key));
  const mine = rows.filter((r) => keys.has(r.permissionKey) || r.permissionKey === `${prefix}.*`);
  if (mine.length === 0) return "DEFAULT";
  if (mine.length === 1 && mine[0].permissionKey === `${prefix}.*`) return mine[0].effect === "DENY" ? "DENIED" : "FULL";
  const allows = mine.filter((r) => r.effect === "ALLOW");
  if (allows.length === 1 && allows[0].permissionKey.endsWith(".view")) return "VIEW_ONLY";
  return "CUSTOM";
}

/** Resolves a scope id to a readable name. */
function useScopeNames() {
  const roles = useRoles();
  const teams = useTeams();
  const events = useEvents();
  const departments = useDepartments();
  const people = usePeople();
  return useMemo(() => {
    const map = new Map<string, string>();
    [roles.data, teams.data, events.data, departments.data, people.data].forEach((list) => list?.forEach((x) => map.set(x.id, x.name)));
    return { name: (id: string) => map.get(id) ?? id, roles, teams, events, departments, people };
  }, [roles, teams, events, departments, people]);
}

function ModuleAccess() {
  const catalog = usePermissionCatalog();
  const roles = useRoles();
  const overrides = useOverrides();
  const apply = useApplyPreset();
  const modules = catalog.data?.filter((m) => !m.isCore) ?? [];
  const [moduleKey, setModuleKey] = useState("finance");
  const selectedModule = modules.find((m) => m.key === moduleKey);

  return (
    <Card className="mb-6">
      <CardHeader
        title="Module access by role"
        description="Quickly set what each role can do in a module. The change is saved as ROLE-level overrides and audited with old and new values."
        action={
          <Select className="h-9 w-48" value={moduleKey} onChange={(e) => setModuleKey(e.target.value)} aria-label="Module">
            {modules.map((m) => (
              <option key={m.key} value={m.key}>
                {m.name}
              </option>
            ))}
          </Select>
        }
      />
      {selectedModule && selectedModule.status !== "ENABLED" && (
        <p className="border-b border-line bg-warn-soft px-5 py-2 text-xs text-warn">
          {selectedModule.name} is {selectedModule.status === "PLANNED" ? `planned for Phase ${selectedModule.phase}` : "disabled"} — these settings take effect once it&apos;s enabled.
        </p>
      )}
      {apply.error && (
        <div className="px-5 pt-3">
          <ErrorNote>{errorMessage(apply.error)}</ErrorNote>
        </div>
      )}
      {!selectedModule || roles.isLoading || overrides.isLoading ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line bg-subtle text-left text-xs text-ink-soft">
              <tr>
                <th className="px-5 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Granted by role</th>
                <th className="px-5 py-2 font-medium">{selectedModule.name} access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roles.data
                ?.filter((r) => !r.isMasterAdmin)
                .map((r) => {
                  const rows = overrides.data?.filter((o) => o.scopeType === "ROLE" && o.scopeId === r.id) ?? [];
                  const preset = detectPreset(rows, selectedModule);
                  const granted = selectedModule.permissions.filter((p) => r.permissions.some((rp) => rp.permissionKey === p.key)).length;
                  return (
                    <tr key={r.id}>
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-ink-faint">{r.department?.name}</div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-soft">
                        {granted} / {selectedModule.permissions.length}
                      </td>
                      <td className="px-5 py-2.5">
                        <Select
                          className="h-8 w-40 text-[13px]"
                          value={preset === "CUSTOM" ? "" : preset}
                          disabled={apply.isPending}
                          aria-label={`${selectedModule.name} access for ${r.name}`}
                          onChange={(e) =>
                            apply.mutate({ scopeType: "ROLE", scopeId: r.id, moduleKey: selectedModule.key, preset: e.target.value as AccessPreset })
                          }
                        >
                          {preset === "CUSTOM" && <option value="">Custom overrides</option>}
                          {PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OverridesList() {
  const overrides = useOverrides();
  const catalog = usePermissionCatalog();
  const remove = useDeleteOverride();
  const save = useSaveOverride();
  const scopes = useScopeNames();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ scopeType: OverrideScope; scopeId: string; permissionKey: string; effect: "ALLOW" | "DENY" }>({
    scopeType: "TEAM",
    scopeId: "",
    permissionKey: "",
    effect: "DENY",
  });

  const scopeOptions: { id: string; name: string }[] =
    {
      DEPARTMENT: scopes.departments.data,
      TEAM: scopes.teams.data,
      EVENT: scopes.events.data,
      ROLE: scopes.roles.data?.filter((r) => !r.isMasterAdmin),
      USER: scopes.people.data,
      GLOBAL: [],
      ORGANIZATION: [],
    }[form.scopeType] ?? [];

  const keyOptions = catalog.data?.flatMap((m) => [
    { value: `${m.permissions[0]?.key.split(".")[0]}.*`, label: `${m.name} — all actions` },
    ...m.permissions.map((p) => ({ value: p.key, label: `${m.name} — ${p.description}` })),
  ]);

  return (
    <Card className="mb-6">
      <CardHeader
        title="Overrides"
        description="Cascade: Global → Organization → Department → Team → Event → Role → User. The most specific level wins; Deny beats Allow at the same level."
        action={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add override
          </Button>
        }
      />
      {remove.error && (
        <div className="px-5 pt-3">
          <ErrorNote>{errorMessage(remove.error)}</ErrorNote>
        </div>
      )}
      {overrides.isLoading ? (
        <Spinner />
      ) : !overrides.data?.length ? (
        <EmptyState title="No overrides" description="Everyone gets exactly what their roles grant." />
      ) : (
        <ul className="divide-y divide-line">
          {overrides.data.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <Badge>{titleCase(o.scopeType)}</Badge>
              <span className="min-w-32 font-medium">{["GLOBAL", "ORGANIZATION"].includes(o.scopeType) ? "Everyone" : scopes.name(o.scopeId)}</span>
              <code className="flex-1 font-mono text-[12px] text-ink-soft">{o.permissionKey}</code>
              <Badge tone={o.effect === "ALLOW" ? "ok" : "danger"}>{o.effect}</Badge>
              <Button size="sm" variant="ghost" aria-label="Remove override" onClick={() => remove.mutate(o.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={adding}
        onClose={() => {
          setAdding(false);
          save.reset();
        }}
        title="Add permission override"
        submitLabel="Save override"
        submitting={save.isPending}
        error={save.error ? errorMessage(save.error) : null}
        onSubmit={() =>
          save.mutate(
            { ...form, scopeId: form.scopeId || undefined },
            { onSuccess: () => setAdding(false) },
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Level" htmlFor="ov-scope">
            <Select id="ov-scope" value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value as OverrideScope, scopeId: "" }))}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
          {!["GLOBAL", "ORGANIZATION"].includes(form.scopeType) && (
            <Field label={titleCase(form.scopeType)} htmlFor="ov-scope-id">
              <Select id="ov-scope-id" required value={form.scopeId} onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}>
                <option value="">Select…</option>
                {scopeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Permission" htmlFor="ov-key">
          <Select id="ov-key" required value={form.permissionKey} onChange={(e) => setForm((f) => ({ ...f, permissionKey: e.target.value }))}>
            <option value="">Select…</option>
            {keyOptions?.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Effect" htmlFor="ov-effect">
          <Select id="ov-effect" value={form.effect} onChange={(e) => setForm((f) => ({ ...f, effect: e.target.value as "ALLOW" | "DENY" }))}>
            <option value="DENY">Deny</option>
            <option value="ALLOW">Allow</option>
          </Select>
        </Field>
      </Dialog>
    </Card>
  );
}

function ExplainTool() {
  const people = usePeople();
  const teams = useTeams();
  const catalog = usePermissionCatalog();
  const explain = useExplain();
  const [q, setQ] = useState({ userId: "", action: "", teamId: "" });

  return (
    <Card>
      <CardHeader title="Check access" description="Why can — or can't — someone do something? Runs the same PermissionService the API uses." />
      <form
        className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          explain.mutate({ userId: q.userId, action: q.action, teamId: q.teamId || undefined });
        }}
      >
        <Field label="Person" htmlFor="ex-user">
          <Select id="ex-user" required value={q.userId} onChange={(e) => setQ((x) => ({ ...x, userId: e.target.value }))}>
            <option value="">Select…</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action" htmlFor="ex-action">
          <Input id="ex-action" list="ex-actions" required value={q.action} onChange={(e) => setQ((x) => ({ ...x, action: e.target.value }))} placeholder="finance.approve" />
          <datalist id="ex-actions">
            {catalog.data?.flatMap((m) => m.permissions).map((p) => <option key={p.key} value={p.key} />)}
          </datalist>
        </Field>
        <Field label="On team (optional)" htmlFor="ex-team">
          <Select id="ex-team" value={q.teamId} onChange={(e) => setQ((x) => ({ ...x, teamId: e.target.value }))}>
            <option value="">Anywhere</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" loading={explain.isPending}>
          Check
        </Button>
      </form>
      {explain.error && (
        <div className="px-5 pb-5">
          <ErrorNote>{errorMessage(explain.error)}</ErrorNote>
        </div>
      )}
      {explain.data && (
        <div className={`mx-5 mb-5 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${explain.data.allowed ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
          {explain.data.allowed ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          <span className="font-semibold">{explain.data.allowed ? "Allowed" : "Denied"}</span> — {explain.data.reason}
        </div>
      )}
    </Card>
  );
}

export default function PermissionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Permissions"
        description="Roles grant permissions; overrides fine-tune them at any level of the organization."
      />
      <ModuleAccess />
      <OverridesList />
      <ExplainTool />
    </>
  );
}

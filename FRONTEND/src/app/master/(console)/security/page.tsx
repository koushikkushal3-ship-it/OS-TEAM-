"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Spinner, Switch } from "@/components/ui/primitives";
import { useResetMfa, useRevokePrivilege, useRotateCode, useSecurity, useUpdateSecurity } from "@/features/administration/api";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime, titleCase } from "@/lib/format";

export default function SecurityPage() {
  const security = useSecurity();
  const update = useUpdateSecurity();
  const rotate = useRotateCode();
  const revoke = useRevokePrivilege();
  const resetMfa = useResetMfa();
  const [code, setCode] = useState("");
  const [minutes, setMinutes] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  if (security.isLoading || !security.data) return <Spinner />;
  const { settings, eligible, privilegedSessions } = security.data;
  const anyError = update.error ?? revoke.error ?? resetMfa.error;

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Security" description="Controls for the hidden Master Admin gateway and privileged sessions." />
      {anyError && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(anyError)}</ErrorNote>
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Gateway policy" description="At least one of the secondary code or MFA must stay on." />
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <div className="text-sm font-medium">Secondary code</div>
                <div className="text-xs text-ink-soft">Ask for the gateway code before MFA</div>
              </div>
              <Switch label="Secondary code" checked={settings.gatewayEnabled} disabled={update.isPending} onChange={(v) => update.mutate({ gatewayEnabled: v })} />
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <div className="text-sm font-medium">Authenticator (TOTP) MFA</div>
                <div className="text-xs text-ink-soft">Require a 6-digit code from an authenticator app</div>
              </div>
              <Switch label="MFA required" checked={settings.mfaRequired} disabled={update.isPending} onChange={(v) => update.mutate({ mfaRequired: v })} />
            </div>
            <form
              className="flex flex-wrap items-end justify-between gap-3 px-5 py-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (minutes) update.mutate({ sessionMinutes: Number(minutes) }, { onSuccess: () => setMinutes(null) });
              }}
            >
              <Field label="Privileged session length (minutes)" htmlFor="sec-min">
                <Input id="sec-min" type="number" min={5} max={480} className="w-32" value={minutes ?? settings.sessionMinutes} onChange={(e) => setMinutes(e.target.value)} />
              </Field>
              <Button type="submit" size="sm" variant="secondary" disabled={!minutes}>
                Save
              </Button>
            </form>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Gateway code"
            description={settings.codeConfigured ? "A code is configured. Rotating it takes effect immediately." : "No code configured yet."}
            action={<Badge tone={settings.codeConfigured ? "ok" : "warn"}>{settings.codeConfigured ? "Configured" : "Missing"}</Badge>}
          />
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              rotate.mutate(code, {
                onSuccess: () => {
                  setCode("");
                  setRotated(true);
                },
              });
            }}
          >
            <Field label="New code" hint="At least 8 characters. Stored only as a hash." htmlFor="sec-code">
              <Input id="sec-code" type="password" autoComplete="new-password" minLength={8} required value={code} onChange={(e) => { setCode(e.target.value); setRotated(false); }} />
            </Field>
            <ErrorNote>{rotate.error && errorMessage(rotate.error)}</ErrorNote>
            {rotated && <p className="text-[13px] text-ok">Gateway code rotated.</p>}
            <Button type="submit" variant="master" loading={rotate.isPending}>
              Rotate code
            </Button>
          </form>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Eligible Master Admins" description="People holding the Master Admin role. Grant or revoke it from People." />
        <ul className="divide-y divide-line">
          {eligible.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{u.name}</div>
                <div className="text-xs text-ink-soft">{u.email}</div>
              </div>
              <Badge tone={u.status === "ACTIVE" ? "ok" : "warn"}>{titleCase(u.status)}</Badge>
              <Badge tone={u.mfaEnrolled ? "ok" : "neutral"}>{u.mfaEnrolled ? "MFA enrolled" : "No MFA yet"}</Badge>
              {u.mfaEnrolled && (
                <Button size="sm" variant="ghost" onClick={() => confirm(`Reset MFA for ${u.name}? They will re-enrol on next gateway entry.`) && resetMfa.mutate(u.id)}>
                  Reset MFA
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Active privileged sessions" />
        <ul className="divide-y divide-line">
          {privilegedSessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {s.user.name} {s.current && <Badge tone="master">This session</Badge>}
                </div>
                <div className="truncate text-xs text-ink-soft">
                  {s.ip ?? "unknown IP"} · {s.userAgent ?? "unknown device"}
                </div>
              </div>
              <span className="text-xs text-ink-faint">until {formatDateTime(s.privilegedUntil)}</span>
              {!s.current && (
                <Button size="sm" variant="danger" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

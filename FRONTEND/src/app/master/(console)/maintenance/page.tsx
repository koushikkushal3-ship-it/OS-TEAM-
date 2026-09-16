"use client";

import { Globe, UserX, Wrench } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Switch } from "@/components/ui/primitives";
import { usePeople } from "@/features/people/api";
import { type MaintenanceSetting, useControl, useMaintenanceSetting } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";
import { formatDateTime } from "@/lib/format";

function WholePortal({ saved }: { saved: MaintenanceSetting }) {
  const { maintenance } = useControl();
  const [message, setMessage] = useState(saved.message);
  return (
    <Card className={saved.enabled ? "border-warn/40" : undefined}>
      <CardHeader
        title="Whole portal — everyone"
        description="Every worker and administrator sees a full-screen Maintenance Mode page with this message and cannot open anything. You keep working while your Master session is open."
        action={<Globe className="size-4 text-ink-faint" />}
      />
      <div className="space-y-4 px-5 pb-5">
        <Field label="Message shown to everyone" htmlFor="mt-all">
          <Input id="mt-all" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="Updating roles for the new term — back in 20 minutes." />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label="Whole portal maintenance" checked={saved.enabled} disabled={maintenance.isPending} onChange={(enabled) => maintenance.mutate({ enabled, message })} />
          {saved.enabled ? <Badge tone="warn">ON — the portal is closed for everyone</Badge> : <span className="text-sm text-ink-soft">Off — everyone can work</span>}
          {saved.enabled && message !== saved.message && (
            <Button size="sm" variant="secondary" onClick={() => maintenance.mutate({ enabled: true, message })}>
              Update message
            </Button>
          )}
        </div>
        {maintenance.error && <ErrorNote>{errorMessage(maintenance.error)}</ErrorNote>}
      </div>
    </Card>
  );
}

function OnePerson({ saved }: { saved: MaintenanceSetting }) {
  const { addMaintenancePerson, removeMaintenancePerson } = useControl();
  const { data: me } = useMe();
  const people = usePeople({});
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");
  const closed = new Set(saved.people.map((p) => p.userId));
  const choices = people.data?.filter((p) => p.status !== "DISABLED" && p.id !== me?.user.id && !closed.has(p.id)) ?? [];
  const error = addMaintenancePerson.error ?? removeMaintenancePerson.error;

  return (
    <Card>
      <CardHeader
        title="One person's portal"
        description="Close the portal for a single person. They see the Maintenance Mode page; everyone else keeps working normally."
        action={<UserX className="size-4 text-ink-faint" />}
      />
      <div className="space-y-4 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Person" htmlFor="mt-person">
            <Select id="mt-person" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose a person…</option>
              {choices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Message for them (optional)" htmlFor="mt-person-msg">
            <Input id="mt-person-msg" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="Your account is being updated." />
          </Field>
          <Button
            disabled={!userId}
            loading={addMaintenancePerson.isPending}
            onClick={() =>
              addMaintenancePerson.mutate(
                { userId, message },
                {
                  onSuccess: () => {
                    setUserId("");
                    setMessage("");
                  },
                },
              )
            }
          >
            <Wrench className="size-4" /> Put in maintenance
          </Button>
        </div>
        {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}

        <div>
          <div className="mb-2 text-[13px] font-medium">Currently closed ({saved.people.length})</div>
          {saved.people.length === 0 ? (
            <EmptyState title="Nobody's portal is closed individually" />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {saved.people.map((p) => (
                <li key={p.userId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <Avatar name={p.name} size={28} />
                  <div className="min-w-48 flex-1">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-ink-soft">
                      Since {formatDateTime(p.since)} · “{p.message || saved.message || "TEAM OS is in maintenance."}”
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" loading={removeMaintenancePerson.isPending && removeMaintenancePerson.variables === p.userId} onClick={() => removeMaintenancePerson.mutate(p.userId)}>
                    End maintenance
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function MaintenancePage() {
  const { data, isLoading } = useMaintenanceSetting();
  if (isLoading || !data) return <Spinner />;
  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Maintenance mode"
        description="Close the portal for everyone, or only for chosen people. Open pages lock and unlock by themselves within 30 seconds. Every change is in the audit log and can be undone there."
      />
      <div className="grid gap-6">
        <WholePortal key={`${data.enabled}-${data.message}`} saved={data} />
        <OnePerson saved={data} />
      </div>
    </>
  );
}

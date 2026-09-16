"use client";

import { CalendarCheck2, CheckCircle2, ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, ErrorNote, Spinner, Switch } from "@/components/ui/primitives";
import { useCalendarIntegration, useCalendarIntegrationActions } from "@/features/platform/schedule";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";

export function CalendarIntegrationCard() {
  const params = useSearchParams();
  const router = useRouter();
  // Read the result of the Google redirect once, then clean the address so a reload doesn't show it again.
  const [callbackError] = useState(() => params.get("calendarError"));
  useEffect(() => {
    if (params.get("calendarError") || params.get("calendar")) router.replace("/master/integrations");
  }, [params, router]);
  const { data, isLoading } = useCalendarIntegration();
  const { sync, sharing, disconnect } = useCalendarIntegrationActions();
  if (isLoading || !data) return <Spinner />;
  const result = sync.data ?? sharing.data;
  const mutationError = sync.error ?? sharing.error ?? disconnect.error;

  return (
    <Card className="mt-6">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <CalendarCheck2 className="size-4 text-ink-faint" /> Google Calendar
          </span>
        }
        description="The organization Schedule, copied into one Google Calendar and shared read-only with every member. Admins, Master Admin and leads edit it in the portal; workers can only see it."
        action={data.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Not connected</Badge>}
      />
      <div className="space-y-4 p-5">
        {callbackError && !data.connected && <ErrorNote>{callbackError === "invalid_state" ? "The connection attempt expired. Click Connect Google Calendar again." : decodeURIComponent(callbackError)}</ErrorNote>}
        {mutationError && <ErrorNote>{errorMessage(mutationError)}</ErrorNote>}
        {!data.configured && <ErrorNote>Google OAuth is not configured on the server, so Calendar cannot be connected yet.</ErrorNote>}

        {data.connected ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-ok" />
              Calendar <span className="font-medium">{data.calendarName}</span> in <span className="font-medium">{data.connectedEmail}</span>
              {data.calendarUrl && (
                <a href={data.calendarUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                  Open <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Switch label="Share with every active member" checked={data.shareWithMembers} disabled={sharing.isPending} onChange={(v) => sharing.mutate(v)} />
              <span className="text-sm">{data.shareWithMembers ? "Shared read-only with every active member's Google account" : "Not shared — only the connected account sees it"}</span>
            </div>
            <p className="text-xs text-ink-faint">
              {data.unsynced > 0 ? `${data.unsynced} entr${data.unsynced === 1 ? "y is" : "ies are"} waiting to be copied. ` : "Everything is copied. "}
              Sharing last updated {formatDateTime(data.lastShareAt)}. Copies retry automatically every 5 minutes.
            </p>
            {data.lastShareError && <ErrorNote>Sharing problem: {data.lastShareError}</ErrorNote>}
            {result && (
              <p className="rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ok">
                Copied {result.synced} entr{result.synced === 1 ? "y" : "ies"}
                {result.failed ? `, ${result.failed} failed` : ""}
                {result.sharing && "added" in result.sharing ? ` · shared with ${result.sharing.added} new, removed ${result.sharing.removed}` : ""}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw className="size-4" /> Sync now
              </Button>
              <Button variant="danger" loading={disconnect.isPending} onClick={() => confirm("Disconnect Google Calendar? The calendar stays in Google but stops updating.") && disconnect.mutate()}>
                <Unplug className="size-4" /> Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <ol className="ml-4 list-decimal space-y-1.5 text-[13px] text-ink-soft">
              <li>
                In Google Cloud Console, enable the <span className="font-medium">Google Calendar API</span> for your project.
              </li>
              <li>
                Add this redirect URI to the same OAuth client:
                <code className="mt-1 block rounded bg-subtle px-2 py-1 font-mono text-[12px] text-ink">{data.redirectUri}</code>
              </li>
              <li>Connect the Google account that should own the organization calendar, and tick every box on the consent screen.</li>
            </ol>
            <a href="/api/integrations/google-calendar/connect" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong">
              <CalendarCheck2 className="size-4" /> Connect Google Calendar <ExternalLink className="size-3.5" />
            </a>
            <p className="text-xs text-ink-faint">
              TEAM OS creates one new calendar and manages only the events in it. It also asks to change sharing, so it can share that calendar read-only with
              members. Google describes that permission as covering every calendar in the account, but TEAM OS only ever uses it on the calendar it created.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

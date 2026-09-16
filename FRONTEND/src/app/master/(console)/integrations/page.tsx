"use client";

import { CheckCircle2, ExternalLink, HardDrive, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Badge, Button, Card, CardHeader, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { useDisconnectDrive, useDriveStatus } from "@/features/operations/api";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { CalendarIntegrationCard } from "@/components/platform/calendar-integration-card";

function DriveCard() {
  const params = useSearchParams();
  const status = useDriveStatus();
  const disconnect = useDisconnectDrive();
  const error = params.get("error");

  if (status.isLoading || !status.data) return <Spinner />;
  const drive = status.data;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <HardDrive className="size-4 text-ink-faint" /> Google Drive
          </span>
        }
        description="Where every file TEAM OS stores actually lives: invoices, payment proof, idea PDFs, sponsor proposals."
        action={drive.connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Not connected</Badge>}
      />

      <div className="space-y-4 p-5">
        {error && <ErrorNote>{decodeURIComponent(error)}</ErrorNote>}
        {disconnect.error && <ErrorNote>{errorMessage(disconnect.error)}</ErrorNote>}

        {!drive.configured && (
          <ErrorNote>Google OAuth is not configured on the server, so Drive cannot be connected yet.</ErrorNote>
        )}

        {drive.connected ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-ok" />
              Files go to the <span className="font-medium">{drive.folderName}</span> folder in{" "}
              <span className="font-medium">{drive.connectedEmail}</span>
            </div>
            <p className="text-xs text-ink-faint">Connected {formatDateTime(drive.connectedAt)}.</p>
            <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              <Unplug className="size-4" /> Disconnect
            </Button>
            <p className="text-xs text-ink-faint">
              Disconnecting stops new uploads and blocks downloads. Files already in Drive stay where they are.
            </p>
          </>
        ) : (
          <>
            <ol className="ml-4 list-decimal space-y-1.5 text-[13px] text-ink-soft">
              <li>
                Enable the <span className="font-medium">Google Drive API</span> for your project in Google Cloud Console.
              </li>
              <li>
                Add this redirect URI to the same OAuth client:
                <code className="mt-1 block rounded bg-subtle px-2 py-1 font-mono text-[12px] text-ink">{drive.redirectUri}</code>
              </li>
              <li>Connect the account whose Drive should hold the organization&apos;s files.</li>
            </ol>
            <a
              href="/api/integrations/google-drive/connect"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
            >
              <HardDrive className="size-4" /> Connect Google Drive <ExternalLink className="size-3.5" />
            </a>
            <p className="text-xs text-ink-faint">
              TEAM OS asks only for the <code className="font-mono">drive.file</code> permission: it can see and manage the files it
              creates, never the rest of the Drive.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Master Control"
        title="Integrations"
        description="External services TEAM OS uses. The portal stays the workspace; these sit behind it."
      />
      <Suspense fallback={<Spinner />}>
        <DriveCard />
        <CalendarIntegrationCard />
      </Suspense>
    </>
  );
}

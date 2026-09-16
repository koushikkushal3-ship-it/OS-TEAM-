"use client";

import { Plus, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from "@/components/ui/primitives";
import { useCreateMeeting, useMeetings } from "@/features/meetings/api";
import { useMe } from "@/lib/auth/use-me";
import { formatMeetingWhen, meetingStatusTone, meetingTypeLabel, titleCase } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";
import { MeetingFormDialog } from "./meeting-form-dialog";

/** Meetings panel reused on team and event pages. */
export function MeetingSection({ teamId, eventId, title }: { teamId?: string; eventId?: string; title: string }) {
  const { data: me } = useMe();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const create = useCreateMeeting();

  const enabled = !!me?.modules.includes("meetings");
  const scope = teamId ? ("team" as const) : ("event" as const);
  const meetings = useMeetings({ scope, teamId, eventId }, enabled);

  if (!enabled) return null;

  return (
    <Card className="mt-6">
      <CardHeader
        title={title}
        description="Scheduled and past meetings, with their attendance and decisions."
        action={
          can("meeting.create") ? (
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" /> New meeting
            </Button>
          ) : undefined
        }
      />
      {meetings.isLoading ? (
        <Spinner />
      ) : !meetings.data?.length ? (
        <EmptyState icon={<Video className="size-6" />} title="No meetings yet" />
      ) : (
        <ul className="divide-y divide-line">
          {meetings.data.slice(0, 8).map((m) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-subtle">
                <div className="min-w-40 flex-1">
                  <div className="truncate text-sm font-medium">{m.title}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">{formatMeetingWhen(m.scheduledStart, m.scheduledEnd)}</div>
                </div>
                <Badge>{meetingTypeLabel[m.type]}</Badge>
                <Badge tone={meetingStatusTone[m.status]}>{m.status === "LIVE" ? "Live" : titleCase(m.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <MeetingFormDialog
        key={creating ? "open" : "closed"}
        mode="create"
        open={creating}
        fixed={{ teamId, eventId }}
        onClose={() => {
          setCreating(false);
          create.reset();
        }}
        saving={create.isPending}
        error={create.error}
        onSave={(input) => create.mutate({ ...input, teamId: teamId ?? input.teamId, eventId: eventId ?? input.eventId }, { onSuccess: () => setCreating(false) })}
      />
    </Card>
  );
}

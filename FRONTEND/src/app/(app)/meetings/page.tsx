"use client";

import { CalendarClock, MapPin, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MeetingFormDialog } from "@/components/meetings/meeting-form-dialog";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { useCreateMeeting, useMeetings } from "@/features/meetings/api";
import { formatMeetingWhen, meetingStatusTone, meetingTypeLabel, titleCase } from "@/lib/format";
import { Can } from "@/lib/permissions/can";

type Tab = "upcoming" | "mine" | "past";

const TABS: { id: Tab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "mine", label: "My meetings" },
  { id: "past", label: "Past" },
];

export default function MeetingsPage() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const create = useCreateMeeting();

  const filters =
    tab === "upcoming"
      ? { upcoming: true }
      : tab === "mine"
        ? { scope: "mine" as const }
        : { status: "ENDED" as const };

  const meetings = useMeetings(filters);

  return (
    <>
      <PageHeader
        eyebrow="03 · Meetings"
        title="Meetings"
        description="Meetings are TEAM OS records: participants, attendance, notes, decisions and follow-up tasks."
        actions={
          <Can permission="meeting.create">
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New meeting
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Meeting filter">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={`${TABS.find((t) => t.id === tab)?.label} meetings`} />
        {meetings.isLoading ? (
          <Spinner />
        ) : !meetings.data?.length ? (
          <EmptyState icon={<Video className="size-6" />} title="No meetings here" description="Meetings you host or are invited to appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {meetings.data.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-subtle">
                  <div className="min-w-48 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{m.title}</span>
                      <Badge tone={meetingStatusTone[m.status]}>{m.status === "LIVE" ? "Live now" : titleCase(m.status)}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3" /> {formatMeetingWhen(m.scheduledStart, m.scheduledEnd)}
                      </span>
                      {m.team && <span>{m.team.name}</span>}
                      {m.event && <span>{m.event.name}</span>}
                      {m.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" /> {m.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge>{meetingTypeLabel[m.type]}</Badge>
                  <span className="text-xs text-ink-faint">{m._count.participants} people</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <MeetingFormDialog
        key={creating ? "open" : "closed"}
        mode="create"
        open={creating}
        onClose={() => {
          setCreating(false);
          create.reset();
        }}
        saving={create.isPending}
        error={create.error}
        onSave={(input) =>
          create.mutate(input, {
            onSuccess: (meeting) => {
              setCreating(false);
              router.push(`/meetings/${meeting.id}`);
            },
          })
        }
      />
    </>
  );
}

"use client";

import { Timer } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui/primitives";
import { useShiftActions, useUpcomingShifts } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";
import { formatDateTime, formatTime } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

export default function ShiftsPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useUpcomingShifts();
  const { signup } = useShiftActions();
  const can = useCan();
  const mine = data?.filter((s) => s.assignments.some((a) => a.userId === me?.user.id)) ?? [];
  const open = data?.filter((s) => !s.assignments.some((a) => a.userId === me?.user.id) && s.assignments.length < s.capacity) ?? [];

  const list = (rows: typeof mine, joined: boolean) =>
    rows.length === 0 ? (
      <EmptyState icon={<Timer className="size-6" />} title={joined ? "You have no upcoming shifts" : "No open shifts"} />
    ) : (
      <ul className="divide-y divide-line">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-48 flex-1">
              <div className="text-sm font-medium">
                {s.title} <span className="font-normal text-ink-soft">· </span>
                <Link href={`/events/${s.eventId}`} className="font-normal text-brand hover:underline">
                  {s.event?.name}
                </Link>
              </div>
              <div className="text-xs text-ink-soft">
                {formatDateTime(s.startsAt)} – {formatTime(s.endsAt)}
                {s.location && ` · ${s.location}`}
              </div>
            </div>
            <Badge tone={s.assignments.length >= s.capacity ? "ok" : "warn"}>
              {s.assignments.length}/{s.capacity} filled
            </Badge>
            {joined ? (
              <Button size="sm" variant="ghost" onClick={() => signup.mutate({ id: s.id, join: false })}>
                Leave shift
              </Button>
            ) : (
              can("shift.signup") && (
                <Button size="sm" loading={signup.isPending && signup.variables?.id === s.id} onClick={() => signup.mutate({ id: s.id, join: true })}>
                  Sign up
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow="02 · Teams & Events" title="Shifts" description="Volunteer shifts across upcoming events. Sign up where help is still needed." />
      {signup.error && (
        <div className="mb-4">
          <ErrorNote>{errorMessage(signup.error)}</ErrorNote>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-6">
          <Card>
            <div className="border-b border-line px-5 py-3 text-sm font-medium">My shifts</div>
            {list(mine, true)}
          </Card>
          <Card>
            <div className="border-b border-line px-5 py-3 text-sm font-medium">Open shifts</div>
            {list(open, false)}
          </Card>
        </div>
      )}
    </>
  );
}

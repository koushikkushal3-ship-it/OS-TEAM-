"use client";

import { CalendarRange, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EventFormDialog } from "@/components/events/event-form-dialog";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { useCreateEvent, useEvents } from "@/features/events/api";
import type { EventStatus } from "@/lib/api/types";
import { eventStatusTone, formatDateRange, titleCase } from "@/lib/format";
import { Can } from "@/lib/permissions/can";

const FILTERS: (EventStatus | "ALL")[] = ["ALL", "PLANNING", "ACTIVE", "COMPLETED", "ARCHIVED"];

export default function EventsPage() {
  const { data: events, isLoading } = useEvents();
  const create = useCreateEvent();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<EventStatus | "ALL">("ALL");

  const visible = useMemo(() => events?.filter((e) => filter === "ALL" || e.status === filter) ?? [], [events, filter]);

  return (
    <>
      <PageHeader
        eyebrow="02 · Teams & Events"
        title="Events"
        description="Each event brings together the teams, people and work it needs."
        actions={
          <Can permission="event.create">
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New event
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {f === "ALL" ? "All" : titleCase(f)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarRange className="size-6" />} title="No events here" description="Events you or your teams work on will appear here." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {visible.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="grid gap-3 px-5 py-4 hover:bg-subtle md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{e.name}</span>
                      <Badge tone={eventStatusTone[e.status]}>{titleCase(e.status)}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                      <span>{formatDateRange(e.startDate, e.endDate)}</span>
                      {e.venue && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" /> {e.venue}
                        </span>
                      )}
                      {e.owner && <span>Owner: {e.owner.name}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 md:justify-end">
                    {e.teams.slice(0, 4).map(({ team }) => (
                      <Badge key={team.id}>{team.name}</Badge>
                    ))}
                    {e.teams.length > 4 && <Badge>+{e.teams.length - 4}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EventFormDialog
        key={open ? "open" : "closed"}
        mode="create"
        open={open}
        onClose={() => {
          setOpen(false);
          create.reset();
        }}
        saving={create.isPending}
        error={create.error}
        onSave={(input) =>
          create.mutate(input, {
            onSuccess: (ev) => {
              setOpen(false);
              router.push(`/events/${ev.id}`);
            },
          })
        }
      />
    </>
  );
}

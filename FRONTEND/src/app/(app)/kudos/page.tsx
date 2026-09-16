"use client";

import { HeartHandshake } from "lucide-react";
import { useState } from "react";
import { GiveKudosDialog } from "@/components/platform/kudos-dialog";
import { Avatar, Button, Card, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { useKudos } from "@/features/platform/api";
import { formatDateTime } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

export default function KudosPage() {
  const { data, isLoading } = useKudos();
  const can = useCan();
  const [giving, setGiving] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="Kudos"
        description="Thanks said out loud. Recognition is counted in the weekly report."
        actions={
          can("kudos.give") && (
            <Button onClick={() => setGiving(true)}>
              <HeartHandshake className="size-4" /> Give kudos
            </Button>
          )
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState icon={<HeartHandshake className="size-6" />} title="No kudos yet" description="Be the first to thank someone." />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((k) => (
              <li key={k.id} className="flex gap-3 px-5 py-4">
                <Avatar name={k.from.name} src={k.from.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">
                    <strong>{k.from.name}</strong> thanked <strong>{k.to.name}</strong>
                    <span className="ml-2 text-xs text-ink-faint">{formatDateTime(k.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-line text-ink-soft">{k.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {giving && <GiveKudosDialog onClose={() => setGiving(false)} />}
    </>
  );
}

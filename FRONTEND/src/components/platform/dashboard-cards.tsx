"use client";

import { HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar, Button, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { useKudos, useMyPerformance } from "@/features/platform/api";
import { useMe } from "@/lib/auth/use-me";
import { useCan } from "@/lib/permissions/can";
import { GiveKudosDialog } from "./kudos-dialog";

const SIGNALS = [
  ["completion", "Tasks completed"],
  ["deadlines", "Finished on time"],
  ["updates", "Recent work updates"],
  ["attendance", "Meeting attendance"],
] as const;

/** A person's own score, with the same four signals and weights leads see. */
export function MyPerformanceCard() {
  const { data } = useMyPerformance();
  if (!data) return null;
  return (
    <Card>
      <CardHeader title="My performance" description="Built from your recorded work. Signals with no data are left out, not counted against you." />
      <div className="flex flex-wrap items-center gap-6 px-5 pb-5">
        <div className="text-center">
          <div className="text-4xl font-semibold tabular-nums">{data.score ?? "—"}</div>
          <div className="text-xs text-ink-faint">{data.score === null ? "Not enough data yet" : "out of 100"}</div>
        </div>
        <ul className="min-w-56 flex-1 space-y-2">
          {SIGNALS.map(([key, label]) => {
            const value = data.breakdown[key];
            return (
              <li key={key}>
                <div className="flex justify-between text-xs">
                  <span className="text-ink-soft">
                    {label} <span className="text-ink-faint">· weight {data.weights[key]}</span>
                  </span>
                  <span className="font-medium tabular-nums">{value === null ? "no data" : `${value}%`}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${value ?? 0}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

export function KudosCard() {
  const can = useCan();
  const { data: me } = useMe();
  const { data } = useKudos(undefined, can("kudos.view"));
  const [giving, setGiving] = useState(false);
  if (!can("kudos.view")) return null;
  const mine = data?.items.filter((k) => k.to.id === me?.user.id).length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Kudos"
        description={mine ? `You were thanked ${mine} time${mine === 1 ? "" : "s"} recently` : "Recent thanks across the organization"}
        action={
          can("kudos.give") && (
            <Button size="sm" variant="secondary" onClick={() => setGiving(true)}>
              <HeartHandshake className="size-3.5" /> Thank someone
            </Button>
          )
        }
      />
      {!data?.items.length ? (
        <EmptyState title="No kudos yet" />
      ) : (
        <ul className="divide-y divide-line">
          {data.items.slice(0, 4).map((k) => (
            <li key={k.id} className="flex gap-2.5 px-5 py-2.5">
              <Avatar name={k.from.name} src={k.from.avatarUrl} size={24} />
              <p className="line-clamp-2 text-[13px] text-ink-soft">
                <strong className="text-ink">{k.from.name}</strong> → <strong className="text-ink">{k.to.name}</strong>: {k.message}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/kudos" className="block border-t border-line px-5 py-2 text-center text-xs text-brand hover:bg-subtle">
        All kudos
      </Link>
      {giving && <GiveKudosDialog onClose={() => setGiving(false)} />}
    </Card>
  );
}

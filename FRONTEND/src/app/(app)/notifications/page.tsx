"use client";

import clsx from "clsx";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, EmptyState, PageHeader, Spinner } from "@/components/ui/primitives";
import { useMarkRead, useNotifications } from "@/features/platform/api";
import { formatDateTime } from "@/lib/format";

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading } = useNotifications(unreadOnly);
  const mark = useMarkRead();

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="Notifications"
        description="Assignments, approvals, reminders and alerts — the last 100."
        actions={
          <>
            <Button variant="secondary" onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? "Show all" : "Unread only"}
            </Button>
            <Button variant="secondary" onClick={() => mark.mutate("all")}>
              Mark all read
            </Button>
          </>
        }
      />
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={<Bell className="size-6" />} title="Nothing here" description="You are all caught up." />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((n) => {
              const body = (
                <>
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="text-[13px] text-ink-soft">{n.body}</div>}
                  <div className="mt-0.5 text-xs text-ink-faint">{formatDateTime(n.createdAt)}</div>
                </>
              );
              return (
                <li key={n.id} className={clsx("flex items-start gap-3 px-5 py-3", !n.readAt && "bg-brand-soft/40")}>
                  <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} />
                  <div className="min-w-0 flex-1" onClick={() => !n.readAt && mark.mutate(n.id)}>
                    {n.link?.startsWith("http") ? (
                      <a href={n.link} target="_blank" rel="noreferrer">
                        {body}
                      </a>
                    ) : n.link ? (
                      <Link href={n.link}>{body}</Link>
                    ) : (
                      body
                    )}
                  </div>
                  {!n.readAt && (
                    <Button size="sm" variant="ghost" onClick={() => mark.mutate(n.id)}>
                      Mark read
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

"use client";

import clsx from "clsx";
import { Bell, Eye, Megaphone, Search, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type SearchResults,
  useActiveAnnouncements,
  useBranding,
  useExitViewAs,
  useMarkRead,
  useNotifications,
  useSearch,
  useUnreadCount,
} from "@/features/platform/api";
import type { Me } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";

/** Applies the organization's brand colour, if Master Admin set one. */
export function BrandColor() {
  const { data } = useBranding();
  useEffect(() => {
    const root = document.documentElement;
    if (data?.brandColor) root.style.setProperty("--color-brand", data.brandColor);
    else root.style.removeProperty("--color-brand");
  }, [data?.brandColor]);
  return null;
}

// ── Search (Ctrl/⌘ + K) ──────────────────────────────────────────────────────

function resultGroups(r: SearchResults) {
  return [
    { label: "People", items: r.people.map((p) => ({ id: p.id, title: p.name, hint: p.email, href: "/people" })) },
    { label: "Teams", items: r.teams.map((t) => ({ id: t.id, title: t.name, hint: "", href: `/teams/${t.id}` })) },
    { label: "Events", items: r.events.map((e) => ({ id: e.id, title: e.name, hint: e.status.toLowerCase(), href: `/events/${e.id}` })) },
    { label: "Tasks", items: r.tasks.map((t) => ({ id: t.id, title: t.title, hint: t.status.toLowerCase().replace(/_/g, " "), href: `/tasks/${t.id}` })) },
    { label: "Meetings", items: r.meetings.map((m) => ({ id: m.id, title: m.title, hint: formatDateTime(m.scheduledStart), href: `/meetings/${m.id}` })) },
    { label: "Tickets", items: r.tickets.map((t) => ({ id: t.id, title: `#${t.number} ${t.title}`, hint: t.status.toLowerCase(), href: "/tickets" })) },
    { label: "Ideas", items: r.ideas.map((i) => ({ id: i.id, title: i.title, hint: i.status.toLowerCase(), href: "/ideas" })) },
    { label: "Files", items: r.files.map((f) => ({ id: f.id, title: f.name, hint: "", href: `/api/files/${f.id}/download` })) },
  ].filter((g) => g.items.length > 0);
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const { data, isFetching } = useSearch(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const groups = useMemo(() => (data ? resultGroups(data) : []), [data]);
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    if (href.startsWith("/api/")) window.open(href, "_blank");
    else router.push(href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-line bg-subtle px-2.5 py-1.5 text-[13px] text-ink-faint hover:text-ink-soft"
        aria-label="Search TEAM OS"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] md:inline">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-rail/40 px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 text-ink-faint" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && groups[0]?.items[0] && go(groups[0].items[0].href)}
                placeholder="Search people, tasks, meetings, events, files…"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
              <button onClick={() => setOpen(false)} aria-label="Close search" className="text-ink-faint hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {debounced.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-[13px] text-ink-faint">Type at least 2 letters. Only things you can already open are shown.</p>
              ) : isFetching && !data ? (
                <p className="px-3 py-6 text-center text-[13px] text-ink-faint">Searching…</p>
              ) : groups.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-ink-faint">Nothing found for “{debounced}”.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="mb-2">
                    <div className="px-3 py-1 text-[11px] font-medium tracking-wider text-ink-faint uppercase">{g.label}</div>
                    {g.items.map((item) => (
                      <button key={item.id} onClick={() => go(item.href)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle">
                        <span className="truncate">{item.title}</span>
                        <span className="shrink-0 text-xs text-ink-faint">{item.hint}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Notifications bell ───────────────────────────────────────────────────────

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: count } = useUnreadCount();
  const { data: items } = useNotifications();
  const mark = useMarkRead();
  const router = useRouter();
  const unread = count?.count ?? 0;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-soft hover:bg-subtle hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 && (
                <button className="text-xs text-brand hover:underline" onClick={() => mark.mutate("all")}>
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {!items?.length && <li className="px-4 py-8 text-center text-[13px] text-ink-faint">You are all caught up.</li>}
              {items?.slice(0, 20).map((n) => (
                <li key={n.id}>
                  <button
                    className={clsx("block w-full px-4 py-2.5 text-left hover:bg-subtle", !n.readAt && "bg-brand-soft/40")}
                    onClick={() => {
                      if (!n.readAt) mark.mutate(n.id);
                      setOpen(false);
                      if (n.link?.startsWith("http")) window.open(n.link, "_blank");
                      else if (n.link) router.push(n.link);
                    }}
                  >
                    <div className="text-[13px] font-medium">{n.title}</div>
                    {n.body && <div className="line-clamp-2 text-xs text-ink-soft">{n.body}</div>}
                    <div className="mt-0.5 text-[11px] text-ink-faint">{formatDateTime(n.createdAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
            <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2 text-center text-xs text-brand hover:bg-subtle">
              See all
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

// ── Banners: preview, maintenance, announcements ─────────────────────────────

export function PlatformBanners({ me }: { me: Me }) {
  const exit = useExitViewAs();
  const router = useRouter();
  const { data: announcements } = useActiveAnnouncements();
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("teamos.dismissed") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem("teamos.dismissed", JSON.stringify(next));
    } catch {
      // Storage can be blocked; the banner simply returns next visit.
    }
  };
  const tone = { info: "bg-brand-soft text-brand-strong", warning: "bg-warn-soft text-warn", success: "bg-ok-soft text-ok" } as const;

  return (
    <>
      {me.viewAs && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-master px-4 py-2 text-[13px] text-white">
          <Eye className="size-4" />
          <span>
            Read-only preview as <strong>{me.user.name}</strong>, opened by {me.viewAs.impersonatorName}. Nothing can be changed here.
          </span>
          <button
            className="rounded-md bg-white/15 px-2.5 py-1 font-medium hover:bg-white/25"
            onClick={() => exit.mutate(undefined, { onSuccess: () => router.push("/master/people") })}
          >
            Exit preview
          </button>
        </div>
      )}
      {me.maintenance?.scope === "everyone" && (
        <div className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-[13px] text-warn">
          <Wrench className="size-4" /> Maintenance mode is on: everyone else sees the maintenance screen{me.maintenance.message ? ` — “${me.maintenance.message}”` : ""}. Switch it off in Master → Maintenance.
        </div>
      )}
      {announcements
        ?.filter((a) => !dismissed.includes(a.id))
        .map((a) => (
          <div key={a.id} className={clsx("flex items-start gap-3 px-4 py-2 text-[13px] lg:px-8", tone[a.tone])}>
            <Megaphone className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              <strong>{a.title}</strong> — {a.body}
            </div>
            <button onClick={() => dismiss(a.id)} aria-label="Dismiss announcement" className="opacity-70 hover:opacity-100">
              <X className="size-4" />
            </button>
          </div>
        ))}
    </>
  );
}

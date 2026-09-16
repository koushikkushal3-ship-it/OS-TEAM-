"use client";

import clsx from "clsx";
import {
  Activity,
  Construction,
  CheckCheck,
  Grid3x3,
  HeartPulse,
  Megaphone,
  Palette,
  Scale,
  Trash,
  Zap,
  Blocks,
  Plug,
  Wrench,
  Building2,
  Contact,
  Gauge,
  KeyRound,
  LogOut,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  CalendarRange,
  Users,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/layout/app-shell";
import { Spinner } from "@/components/ui/primitives";
import { useGatewayExit } from "@/features/administration/api";
import { ApiError } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";
import { useBinCount } from "@/features/platform/api";

const ADMIN_NAV = [
  { href: "/master", label: "Overview", icon: Gauge },
  { href: "/master/organization", label: "Organization", icon: Building2 },
  { href: "/master/people", label: "People", icon: Contact },
  { href: "/master/roles", label: "Roles", icon: UsersRound },
  { href: "/master/permissions", label: "Permissions", icon: KeyRound },
  { href: "/master/access-map", label: "Access map", icon: Grid3x3 },
  { href: "/master/approvals", label: "Approvals", icon: CheckCheck },
  { href: "/teams", label: "Teams", icon: Users, external: true },
  { href: "/events", label: "Events", icon: CalendarRange, external: true },
  { href: "/master/modules", label: "Modules", icon: Blocks },
  { href: "/master/builder", label: "Module builder", icon: Wrench },
  { href: "/master/automations", label: "Automations", icon: Zap },
  { href: "/master/announcements", label: "Announcements", icon: Megaphone },
  { href: "/master/policies", label: "Policies", icon: Scale },
  { href: "/master/branding", label: "Branding", icon: Palette },
  { href: "/master/integrations", label: "Integrations", icon: Plug },
  { href: "/master/security", label: "Security", icon: ShieldCheck },
  { href: "/master/maintenance", label: "Maintenance", icon: Construction },
  { href: "/master/activity", label: "Sign-ins & alerts", icon: Activity },
  { href: "/master/health", label: "System health", icon: HeartPulse },
  { href: "/master/recycle-bin", label: "Recycle bin", icon: Trash },
  { href: "/master/audit", label: "Audit log", icon: ScrollText },
];

function useCountdown(until: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  const ms = Math.max(0, new Date(until).getTime() - now);
  return { ms, label: `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}` };
}

export default function MasterConsoleLayout({ children }: { children: ReactNode }) {
  const binCount = useBinCount().data?.review ?? 0;
  const { data: me, error, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const exit = useGatewayExit();
  const countdown = useCountdown(me?.master?.privilegedUntil);

  const needsGateway = me?.master && !me.master.privileged;
  const expired = countdown?.ms === 0;
  useEffect(() => {
    if (needsGateway || expired) router.replace("/master/gateway");
  }, [needsGateway, expired, router]);
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace("/login");
  }, [error, router]);

  if (me && !me.master) notFound();
  if (isLoading || !me?.master?.privileged) return <Spinner />;

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-rail-line bg-rail lg:flex">
        <div className="flex h-14 items-center border-b border-rail-line px-4">
          <Logo />
        </div>
        <div className="mx-3 mt-4 rounded-lg bg-master/25 px-3 py-2 text-[11px] font-semibold tracking-wider text-red-100 uppercase">Master Control</div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Master Admin">
          {ADMIN_NAV.map(({ href, label, icon: Icon, external }) => {
            const active = href === "/master" ? pathname === "/master" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px]",
                  active ? "bg-rail-soft text-white" : "text-rail-text hover:bg-rail-soft/60 hover:text-white",
                )}
              >
                <Icon className="size-4" /> <span className="flex-1">{label}
                {href === "/master/recycle-bin" && binCount ? <span className="ml-auto rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{binCount}</span> : null}</span>
                {external && <span className="text-[10px] text-rail-text/60">workspace</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-rail-line p-3">
          <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-rail-text hover:bg-rail-soft hover:text-white">
            <ArrowLeft className="size-4" /> Back to workspace
          </Link>
        </div>
      </aside>

      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 bg-master px-4 py-2 text-white lg:px-8">
        <SlidersHorizontal className="size-4" />
        <span className="text-[13px] font-semibold tracking-wide uppercase">Master Admin session</span>
        <span className="text-[13px] text-red-100">
          {me.user.name} · expires in <span className="font-mono tabular-nums">{countdown?.label}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <nav className="flex gap-1 lg:hidden" aria-label="Master Admin (mobile)">
            <select
              className="h-8 rounded-md bg-white/10 px-2 text-[13px] text-white"
              value={ADMIN_NAV.find((n) => (n.href === "/master" ? pathname === "/master" : pathname.startsWith(n.href)))?.href ?? "/master"}
              onChange={(e) => router.push(e.target.value)}
              aria-label="Section"
            >
              {ADMIN_NAV.map((n) => (
                <option key={n.href} value={n.href} className="text-ink">
                  {n.label}
                </option>
              ))}
            </select>
          </nav>
          <button
            onClick={() => exit.mutate(undefined, { onSuccess: () => router.replace("/dashboard") })}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-3 text-[13px] font-medium hover:bg-white/25"
          >
            <LogOut className="size-3.5" /> Exit
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}

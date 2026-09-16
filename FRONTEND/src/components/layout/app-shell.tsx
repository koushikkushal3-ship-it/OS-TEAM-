"use client";

import clsx from "clsx";
import { Blocks, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import type { Me } from "@/lib/api/types";
import { useAvailableModules } from "@/features/custom/api";
import { useLogout, useMe } from "@/lib/auth/use-me";
import { Avatar, Spinner } from "../ui/primitives";
import { NAV } from "./nav-config";
import { MaintenanceScreen } from "../platform/maintenance-screen";
import { BrandColor, GlobalSearch, NotificationBell, PlatformBanners } from "./platform-bar";
import { InstallApp } from "../platform/install-app";

export function Logo({ dark = true }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-brand font-mono text-[13px] font-bold text-white">OS</span>
      <span className={clsx("text-[15px] font-semibold tracking-tight", dark ? "text-white" : "text-ink")}>TEAM OS</span>
    </div>
  );
}

function Sidebar({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Modules Master Admin built at runtime get their own section.
  const custom = useAvailableModules();
  const permissions = new Set(me.permissions);
  const planned = new Map(me.plannedModules.map((m) => [m.key, m.phase]));

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {NAV.map((section) => {
        const items = section.items.filter(
          (item) =>
            (me.modules.includes(item.module) || planned.has(item.module)) &&
            (!item.permission || permissions.has(item.permission)),
        );
        if (items.length === 0) return null;
        return (
          <div key={section.id}>
            <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-medium tracking-wider text-rail-text/60 uppercase">
              <span className="font-mono">{section.id}</span>
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const phase = planned.get(item.module);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] transition-colors",
                        active ? "bg-rail-soft text-white" : "text-rail-text hover:bg-rail-soft/60 hover:text-white",
                        phase && !active && "opacity-60",
                      )}
                    >
                      <Icon className={clsx("size-4", active && "text-brand-soft")} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {phase && <span className="rounded bg-rail-line px-1.5 py-px text-[10px] text-rail-text">Soon</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {custom.data && custom.data.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-medium tracking-wider text-rail-text/60 uppercase">
            <span className="font-mono">06</span>
            Custom
          </div>
          <ul className="space-y-0.5">
            {custom.data.map((module) => {
              const href = `/m/${module.moduleKey}`;
              const active = pathname === href;
              return (
                <li key={module.moduleKey}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    className={clsx(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] transition-colors",
                      active ? "bg-rail-soft text-white" : "text-rail-text hover:bg-rail-soft/60 hover:text-white",
                    )}
                  >
                    <Blocks className={clsx("size-4", active && "text-brand-soft")} aria-hidden />
                    <span className="flex-1 truncate">{module.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, error, isLoading } = useMe();
  const logout = useLogout();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);

  if (isLoading || !me) {
    return <div className="grid min-h-screen place-items-center">{error && !(error instanceof ApiError && error.status === 401) ? <p className="text-sm text-danger">Could not reach TEAM OS. Is the backend running?</p> : <Spinner />}</div>;
  }

  // Only a Master Admin in a privileged session keeps working while the portal is closed.
  if (me.maintenance && !me.master?.privileged) return <MaintenanceScreen me={me} />;

  const rail = (
    <>
      <div className="flex h-14 items-center justify-between border-b border-rail-line px-4">
        <Logo />
        <button className="text-rail-text lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="size-5" />
        </button>
      </div>
      <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
      <div className="border-t border-rail-line p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <Avatar name={me.user.name} src={me.user.avatarUrl} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-white">{me.user.name}</div>
            <div className="truncate text-[11px] text-rail-text">{me.roles[0]?.name ?? me.user.email}</div>
          </div>
          <button
            onClick={() => logout.mutate()}
            className="rounded-md p-1.5 text-rail-text hover:bg-rail-soft hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-rail lg:flex">{rail}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-rail/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-rail">{rail}</aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur lg:px-8">
        <button className="text-ink-soft lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
          <span className="font-medium text-ink">{me.user.organization.name}</span>
          {me.user.department && <span className="hidden sm:inline"> · {me.user.department.name}</span>}
        </div>
        <GlobalSearch />
        <NotificationBell />
      </header>
      <PlatformBanners me={me} />
      <BrandColor />
      <InstallApp />

      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}

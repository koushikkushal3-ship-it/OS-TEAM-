"use client";

import { LogOut, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import type { Me } from "@/lib/api/types";
import { useLogout } from "@/lib/auth/use-me";

/** Replaces the whole portal while Master Admin has maintenance mode on. */
export function MaintenanceScreen({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6 py-12">
      <div className="max-w-2xl text-center">
        <div className="mx-auto mb-8 grid size-20 place-items-center rounded-2xl bg-warn-soft text-warn">
          <Wrench className="size-10" aria-hidden />
        </div>
        <p className="mb-3 text-sm font-medium tracking-widest text-ink-faint uppercase">{me.user.organization.name}</p>
        <h1 className="text-5xl font-bold tracking-tight text-ink sm:text-6xl">Maintenance Mode</h1>
        {me.maintenance?.message && <p className="mx-auto mt-6 max-w-xl text-2xl leading-relaxed whitespace-pre-line text-ink-soft sm:text-3xl">{me.maintenance.message}</p>}
        <p className="mt-8 text-sm text-ink-faint">TEAM OS is closed for a short while. This page opens again by itself when maintenance ends.</p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {me.master && (
            <Link href="/master" className="inline-flex h-10 items-center gap-2 rounded-lg bg-master px-4 text-sm font-medium text-white hover:bg-master/90">
              <ShieldCheck className="size-4" /> Master console
            </Link>
          )}
          <Button variant="secondary" onClick={() => logout.mutate()}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

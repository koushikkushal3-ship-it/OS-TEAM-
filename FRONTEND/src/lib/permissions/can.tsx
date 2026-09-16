"use client";

import type { ReactNode } from "react";
import { useMe } from "../auth/use-me";

/**
 * UI-only permission hints from /auth/me ("holds it somewhere").
 * The backend PermissionService is always the real authority.
 */
export function useCan() {
  const { data } = useMe();
  const permissions = new Set(data?.permissions ?? []);
  return (permission: string) => permissions.has(permission);
}

export function Can({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  const can = useCan();
  return <>{can(permission) ? children : fallback}</>;
}

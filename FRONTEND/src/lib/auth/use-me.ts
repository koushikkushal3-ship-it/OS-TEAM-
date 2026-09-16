"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "../api/client";
import type { Me } from "../api/types";

export const meKey = ["auth", "me"] as const;

export function useMe() {
  // Re-checked every 30 seconds so maintenance mode locks and unlocks open pages without a reload.
  return useQuery({ queryKey: meKey, queryFn: () => api<Me>("/auth/me"), staleTime: 30_000, refetchInterval: 30_000 });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.clear();
      router.replace("/login");
    },
  });
}

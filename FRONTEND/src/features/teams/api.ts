"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { TeamDetail, TeamListItem, TeamMemberRole } from "@/lib/api/types";

export const teamKeys = {
  all: ["teams"] as const,
  detail: (id: string) => ["teams", id] as const,
};

export const useTeams = () => useQuery({ queryKey: teamKeys.all, queryFn: () => api<TeamListItem[]>("/teams") });

export const useTeam = (id: string) =>
  useQuery({ queryKey: teamKeys.detail(id), queryFn: () => api<TeamDetail>(`/teams/${id}`) });

export interface TeamInput {
  name: string;
  description?: string | null;
  departmentId?: string | null;
  leadUserId?: string;
  isActive?: boolean;
}

function useInvalidateTeams() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: teamKeys.all });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["auth", "me"] });
  };
}

export function useCreateTeam() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (body: TeamInput) => api<{ id: string }>("/teams", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useUpdateTeam(id: string) {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (body: Partial<TeamInput>) => api(`/teams/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteTeam() {
  const invalidate = useInvalidateTeams();
  return useMutation({ mutationFn: (id: string) => api(`/teams/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useSetTeamMember(teamId: string) {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: ({ userId, memberRole }: { userId: string; memberRole: TeamMemberRole }) =>
      api(`/teams/${teamId}/members/${userId}`, { method: "PUT", body: { memberRole } }),
    onSuccess: invalidate,
  });
}

export function useRemoveTeamMember(teamId: string) {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (userId: string) => api(`/teams/${teamId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

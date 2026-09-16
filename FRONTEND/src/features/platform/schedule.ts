"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

export type ScheduleScope = "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "EVENT";

export interface ScheduleEntry {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  scopeType: ScheduleScope;
  scopeId: string | null;
  category: string;
  audience: string;
  canEdit: boolean;
  googleSynced: boolean;
  googleSyncError: string | null;
}

export interface ScheduleInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  scopeType: ScheduleScope;
  scopeId?: string | null;
  category: string;
}

export const useSchedule = (from: Date, to: Date) =>
  useQuery({
    queryKey: ["schedule", from.toISOString(), to.toISOString()],
    queryFn: () =>
      api<{ items: ScheduleEntry[]; capabilities: { canManage: boolean }; google: { connected: boolean; calendarUrl: string | null } }>("/schedule", {
        query: { from: from.toISOString(), to: to.toISOString() },
      }),
  });

export function useScheduleActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["schedule"] });
    void qc.invalidateQueries({ queryKey: ["calendar"] });
  };
  return {
    save: useMutation({
      mutationFn: ({ id, ...body }: ScheduleInput & { id?: string }) => (id ? api(`/schedule/${id}`, { method: "PATCH", body }) : api("/schedule", { method: "POST", body })),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/schedule/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export interface CalendarIntegration {
  configured: boolean;
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: string | null;
  calendarName: string | null;
  calendarUrl: string | null;
  shareWithMembers: boolean;
  lastShareAt: string | null;
  lastShareError: string | null;
  redirectUri: string;
  unsynced: number;
}

export interface SyncResult {
  connected: boolean;
  synced: number;
  failed: number;
  deleted: number;
  sharing: { added: number; removed: number } | { error: string } | null;
}

export const useCalendarIntegration = () =>
  useQuery({ queryKey: ["master", "google-calendar"], queryFn: () => api<CalendarIntegration>("/integrations/google-calendar"), retry: false });

export function useCalendarIntegrationActions() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["master", "google-calendar"] });
    void qc.invalidateQueries({ queryKey: ["schedule"] });
  };
  return {
    sync: useMutation({ mutationFn: () => api<SyncResult>("/integrations/google-calendar/sync", { method: "POST" }), onSuccess: invalidate }),
    sharing: useMutation({ mutationFn: (shareWithMembers: boolean) => api<SyncResult>("/integrations/google-calendar/sharing", { method: "PUT", body: { shareWithMembers } }), onSuccess: invalidate }),
    disconnect: useMutation({ mutationFn: () => api("/integrations/google-calendar/disconnect", { method: "POST" }), onSuccess: invalidate }),
  };
}

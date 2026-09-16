"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type {
  AttendancePolicy,
  AttendanceStats,
  AttendanceStatus,
  Meeting,
  MeetingDetail,
  MeetingStatus,
  MeetingType,
  ParticipantRole,
} from "@/lib/api/types";

export interface MeetingFilters {
  scope?: "mine" | "team" | "event" | "all";
  teamId?: string;
  eventId?: string;
  status?: MeetingStatus;
  upcoming?: boolean;
}

export const meetingKeys = {
  all: ["meetings"] as const,
  list: (f: MeetingFilters) => ["meetings", "list", f] as const,
  detail: (id: string) => ["meetings", id] as const,
};

export const useMeetings = (filters: MeetingFilters = {}, enabled = true) =>
  useQuery({
    queryKey: meetingKeys.list(filters),
    queryFn: () =>
      api<Meeting[]>("/meetings", {
        query: {
          scope: filters.scope,
          teamId: filters.teamId,
          eventId: filters.eventId,
          status: filters.status,
          upcoming: filters.upcoming ? "true" : undefined,
        },
      }),
    enabled,
  });

export const useMeeting = (id: string) =>
  useQuery({ queryKey: meetingKeys.detail(id), queryFn: () => api<MeetingDetail>(`/meetings/${id}`) });

export const useAttendanceStats = (filter: { userId?: string; teamId?: string; eventId?: string } = {}, enabled = true) =>
  useQuery({
    queryKey: ["attendance", "stats", filter],
    queryFn: () => api<AttendanceStats>("/attendance/stats", { query: filter }),
    enabled,
  });

export const useAttendancePolicy = (enabled = true) =>
  useQuery({ queryKey: ["attendance", "policy"], queryFn: () => api<AttendancePolicy>("/attendance/policy"), enabled });

export interface MeetingInput {
  title: string;
  description?: string | null;
  type?: MeetingType;
  teamId?: string | null;
  eventId?: string | null;
  joinUrl?: string | null;
  location?: string | null;
  agenda?: string | null;
  notes?: string | null;
  status?: MeetingStatus;
  scheduledStart?: string;
  scheduledEnd?: string;
  participantIds?: string[];
}

function useInvalidateMeetings() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: meetingKeys.all });
    void qc.invalidateQueries({ queryKey: ["attendance"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function useCreateMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (body: MeetingInput) => api<Meeting>("/meetings", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useUpdateMeeting(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (body: MeetingInput) => api<Meeting>(`/meetings/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteMeeting() {
  const invalidate = useInvalidateMeetings();
  return useMutation({ mutationFn: (id: string) => api(`/meetings/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useMeetingLifecycle(id: string) {
  const invalidate = useInvalidateMeetings();
  const start = useMutation({ mutationFn: () => api(`/meetings/${id}/start`, { method: "POST" }), onSuccess: invalidate });
  const end = useMutation({ mutationFn: () => api(`/meetings/${id}/end`, { method: "POST" }), onSuccess: invalidate });
  const join = useMutation({
    mutationFn: () => api<{ joinUrl: string | null; location: string | null }>(`/meetings/${id}/join`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const leave = useMutation({ mutationFn: () => api(`/meetings/${id}/leave`, { method: "POST" }), onSuccess: invalidate });
  return { start, end, join, leave };
}

export function useSetParticipant(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (body: { userId: string; role: ParticipantRole }) => api(`/meetings/${id}/participants`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useRemoveParticipant(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (userId: string) => api(`/meetings/${id}/participants/${userId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useAddSession(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (body: { userId?: string; joinedAt: string; leftAt?: string | null }) =>
      api(`/meetings/${id}/sessions`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useOverrideAttendance(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: ({ userId, status, note }: { userId: string; status: AttendanceStatus; note?: string | null }) =>
      api(`/meetings/${id}/attendance/${userId}`, { method: "PATCH", body: { status, note } }),
    onSuccess: invalidate,
  });
}

export function useMeetingNotes(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (notes: string) => api(`/meetings/${id}`, { method: "PATCH", body: { notes } }),
    onSuccess: invalidate,
  });
}

export function useAddDecision(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (text: string) => api(`/meetings/${id}/decisions`, { method: "POST", body: { text } }),
    onSuccess: invalidate,
  });
}

export function useRemoveDecision(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (decisionId: string) => api(`/meetings/${id}/decisions/${decisionId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useAddActionItem(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (body: { text: string; ownerId?: string | null; dueDate?: string | null; createTask: boolean }) =>
      api(`/meetings/${id}/actions`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useRemoveActionItem(id: string) {
  const invalidate = useInvalidateMeetings();
  return useMutation({
    mutationFn: (actionId: string) => api(`/meetings/${id}/actions/${actionId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

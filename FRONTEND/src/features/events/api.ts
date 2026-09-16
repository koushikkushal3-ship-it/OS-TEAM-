"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { EventDetail, EventListItem, EventStatus } from "@/lib/api/types";

export const eventKeys = {
  all: ["events"] as const,
  detail: (id: string) => ["events", id] as const,
};

export const useEvents = () => useQuery({ queryKey: eventKeys.all, queryFn: () => api<EventListItem[]>("/events") });

export const useEvent = (id: string) =>
  useQuery({ queryKey: eventKeys.detail(id), queryFn: () => api<EventDetail>(`/events/${id}`) });

export interface EventInput {
  name: string;
  description?: string | null;
  venue?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  budget?: number | null;
  status?: EventStatus;
  teamIds?: string[];
}

function useInvalidateEvents() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: eventKeys.all });
    void qc.invalidateQueries({ queryKey: ["teams"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (body: EventInput) => api<{ id: string }>("/events", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent(id: string) {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (body: Omit<EventInput, "teamIds">) => api(`/events/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({ mutationFn: (id: string) => api(`/events/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useSetEventTeams(id: string) {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (teamIds: string[]) => api(`/events/${id}/teams`, { method: "PUT", body: { teamIds } }),
    onSuccess: invalidate,
  });
}

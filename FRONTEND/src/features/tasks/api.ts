"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Task, TaskDetail, TaskPriority, TaskStats, TaskStatus } from "@/lib/api/types";

export interface TaskFilters {
  scope?: "mine" | "created" | "team" | "event" | "all";
  teamId?: string;
  eventId?: string;
  assignedToId?: string;
  status?: TaskStatus;
  open?: boolean;
  overdue?: boolean;
}

export const taskKeys = {
  all: ["tasks"] as const,
  list: (f: TaskFilters) => ["tasks", "list", f] as const,
  detail: (id: string) => ["tasks", id] as const,
  stats: (f: { teamId?: string; eventId?: string } | "mine") => ["tasks", "stats", f] as const,
};

export const useTasks = (filters: TaskFilters = {}, enabled = true) =>
  useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () =>
      api<Task[]>("/tasks", {
        query: {
          scope: filters.scope,
          teamId: filters.teamId,
          eventId: filters.eventId,
          assignedToId: filters.assignedToId,
          status: filters.status,
          open: filters.open ? "true" : undefined,
          overdue: filters.overdue ? "true" : undefined,
        },
      }),
    enabled,
  });

export const useTask = (id: string) => useQuery({ queryKey: taskKeys.detail(id), queryFn: () => api<TaskDetail>(`/tasks/${id}`) });

export const useTaskStats = (filter: { teamId?: string; eventId?: string } | "mine", enabled = true) =>
  useQuery({
    queryKey: taskKeys.stats(filter),
    queryFn: () => (filter === "mine" ? api<TaskStats>("/tasks/stats/mine") : api<TaskStats>("/tasks/stats", { query: filter })),
    enabled,
  });

export interface TaskInput {
  title: string;
  description?: string | null;
  teamId?: string | null;
  eventId?: string | null;
  parentTaskId?: string | null;
  assignedToId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  startDate?: string | null;
  dueDate?: string | null;
  percentage?: number;
}

function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: taskKeys.all });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({ mutationFn: (body: TaskInput) => api<Task>("/tasks", { method: "POST", body }), onSuccess: invalidate });
}

export function useUpdateTask(id: string) {
  const invalidate = useInvalidateTasks();
  return useMutation({ mutationFn: (body: TaskInput) => api<Task>(`/tasks/${id}`, { method: "PATCH", body }), onSuccess: invalidate });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({ mutationFn: (id: string) => api(`/tasks/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export interface WorkUpdateInput {
  percentage: number;
  summary: string;
  blockers?: string | null;
  status?: TaskStatus;
}

export function useSubmitWorkUpdate(taskId: string) {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: WorkUpdateInput) => api(`/tasks/${taskId}/updates`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useReviewWorkUpdate(taskId: string) {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ updateId, decision, note }: { updateId: string; decision: "ACCEPT" | "CHANGES_REQUESTED"; note?: string }) =>
      api(`/tasks/${taskId}/updates/${updateId}/review`, { method: "POST", body: { decision, note } }),
    onSuccess: invalidate,
  });
}

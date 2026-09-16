"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Department, Person, UserStatus } from "@/lib/api/types";

export const usePeople = (filters: { search?: string; status?: UserStatus | "" } = {}, enabled = true) =>
  useQuery({
    queryKey: ["people", filters],
    queryFn: () => api<Person[]>("/users", { query: { search: filters.search, status: filters.status } }),
    enabled,
  });

export const useDepartments = (enabled = true) =>
  useQuery({ queryKey: ["departments"], queryFn: () => api<Department[]>("/departments"), enabled });

function useInvalidatePeople() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["people"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["master"] });
  };
}

export function useInvitePerson() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: (body: { email: string; name: string; departmentId?: string | null }) =>
      api<Person>("/users", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useUpdatePerson() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; departmentId?: string | null }) =>
      api(`/users/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useSetPersonEnabled() {
  const invalidate = useInvalidatePeople();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api(`/users/${id}/${enabled ? "enable" : "disable"}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

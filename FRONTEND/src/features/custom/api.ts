"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Ref } from "@/lib/api/types";

export const FIELD_TYPES = ["text", "textarea", "number", "money", "date", "select", "checkbox", "email", "phone", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export interface CustomDefinition {
  id: string;
  moduleKey: string;
  name: string;
  description: string | null;
  icon: string;
  fields: FieldDef[];
  statuses: string[];
  scopeEvent: boolean;
  scopeTeam: boolean;
  createdAt: string;
  _count: { records: number };
}

export interface CustomDefinitionDetail extends CustomDefinition {
  capabilities: { canCreate: boolean; canUpdate: boolean; canDelete: boolean };
}

export interface CustomRecord {
  id: string;
  title: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  teamId: string | null;
  eventId: string | null;
  team: Ref | null;
  event: Ref | null;
  owner: (Ref & { avatarUrl: string | null }) | null;
  createdBy: Ref | null;
}

export interface DefinitionInput {
  name: string;
  description?: string | null;
  icon: string;
  fields: FieldDef[];
  statuses: string[];
  scopeEvent: boolean;
  scopeTeam: boolean;
}

export interface RecordInput {
  title: string;
  status: string;
  data: Record<string, unknown>;
  teamId?: string | null;
  eventId?: string | null;
  ownerId?: string | null;
}

function useInvalidateCustom() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["custom"] });
    void qc.invalidateQueries({ queryKey: ["master", "builder"] });
    // A new module changes navigation and the permission catalog.
    void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    void qc.invalidateQueries({ queryKey: ["master", "catalog"] });
    void qc.invalidateQueries({ queryKey: ["master", "modules"] });
  };
}

/** Custom modules this person may open — drives navigation. */
export const useAvailableModules = (enabled = true) =>
  useQuery({ queryKey: ["custom", "available"], queryFn: () => api<CustomDefinition[]>("/custom"), enabled, staleTime: 60_000 });

export const useCustomDefinition = (moduleKey: string) =>
  useQuery({ queryKey: ["custom", moduleKey], queryFn: () => api<CustomDefinitionDetail>(`/custom/${moduleKey}`) });

export const useCustomRecords = (moduleKey: string, filter: { status?: string; mine?: boolean } = {}) =>
  useQuery({
    queryKey: ["custom", moduleKey, "records", filter],
    queryFn: () =>
      api<CustomRecord[]>(`/custom/${moduleKey}/records`, {
        query: { status: filter.status, mine: filter.mine ? "true" : undefined },
      }),
  });

export function useSaveRecord(moduleKey: string) {
  const invalidate = useInvalidateCustom();
  return useMutation({
    mutationFn: ({ id, ...body }: RecordInput & { id?: string }) =>
      id
        ? api<CustomRecord>(`/custom/${moduleKey}/records/${id}`, { method: "PATCH", body })
        : api<CustomRecord>(`/custom/${moduleKey}/records`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteRecord(moduleKey: string) {
  const invalidate = useInvalidateCustom();
  return useMutation({
    mutationFn: (id: string) => api(`/custom/${moduleKey}/records/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

// ── builder (Master Admin) ───────────────────────────────────────────────────

export const useDefinitions = () =>
  useQuery({ queryKey: ["master", "builder"], queryFn: () => api<CustomDefinition[]>("/master/builder") });

export function useSaveDefinition() {
  const invalidate = useInvalidateCustom();
  return useMutation({
    mutationFn: ({ id, ...body }: DefinitionInput & { id?: string }) =>
      id
        ? api<CustomDefinition>(`/master/builder/${id}`, { method: "PATCH", body })
        : api<CustomDefinition>("/master/builder", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteDefinition() {
  const invalidate = useInvalidateCustom();
  return useMutation({ mutationFn: (id: string) => api(`/master/builder/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

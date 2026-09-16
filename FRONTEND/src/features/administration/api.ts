"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type {
  AuditEntry,
  CatalogModule,
  GatewayStatus,
  MasterOverview,
  ModuleAccess,
  ModuleRow,
  ModuleStatus,
  OverrideScope,
  PermissionOverride,
  Role,
  RoleScope,
  SecurityOverview,
} from "@/lib/api/types";

const k = {
  gateway: ["master", "gateway"] as const,
  overview: ["master", "overview"] as const,
  roles: ["master", "roles"] as const,
  catalog: ["master", "catalog"] as const,
  overrides: ["master", "overrides"] as const,
  modules: ["master", "modules"] as const,
  security: ["master", "security"] as const,
  audit: (f: object) => ["master", "audit", f] as const,
};

function useInvalidateMaster() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["master"] });
    void qc.invalidateQueries({ queryKey: ["people"] });
    void qc.invalidateQueries({ queryKey: ["auth", "me"] });
  };
}

// ── Gateway ──────────────────────────────────────────────────────────────────

export const useGatewayStatus = () =>
  useQuery({ queryKey: k.gateway, queryFn: () => api<GatewayStatus>("/master/gateway"), retry: false, refetchInterval: 60_000 });

export function useGatewayCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<GatewayStatus>("/master/gateway/code", { method: "POST", body: { code } }),
    onSuccess: (status) => {
      qc.setQueryData(k.gateway, status);
      void qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export const useMfaSetup = () =>
  useMutation({
    mutationFn: () => api<{ otpauthUrl: string; qrDataUrl: string; secret: string }>("/master/gateway/mfa/setup", { method: "POST" }),
  });

export function useMfaVerify() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: (token: string) => api("/master/gateway/mfa/verify", { method: "POST", body: { token } }),
    onSuccess: invalidate,
  });
}

export function useGatewayExit() {
  const invalidate = useInvalidateMaster();
  return useMutation({ mutationFn: () => api("/master/gateway/exit", { method: "POST" }), onSuccess: invalidate });
}

// ── Console ──────────────────────────────────────────────────────────────────

export const useMasterOverview = () => useQuery({ queryKey: k.overview, queryFn: () => api<MasterOverview>("/master/overview") });

export const useOrganization = () =>
  useQuery({ queryKey: ["master", "organization"], queryFn: () => api<{ id: string; name: string; slug: string }>("/master/organization") });

export function useUpdateOrganization() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: (name: string) => api("/master/organization", { method: "PATCH", body: { name } }),
    onSuccess: invalidate,
  });
}

export function useSaveDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name: string; description?: string | null; isActive?: boolean }) =>
      id ? api(`/departments/${id}`, { method: "PATCH", body }) : api("/departments", { method: "POST", body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["departments"] }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/departments/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["departments"] }),
  });
}

export function useAssignRole() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; roleId: string; scopeType: RoleScope; scopeId?: string | null }) =>
      api(`/master/users/${userId}/roles`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useRemoveRole() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: ({ userId, assignmentId }: { userId: string; assignmentId: string }) =>
      api(`/master/users/${userId}/roles/${assignmentId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export const useRoles = () => useQuery({ queryKey: k.roles, queryFn: () => api<Role[]>("/master/roles") });

export function useSaveRole() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: async ({
      id,
      permissionKeys,
      ...body
    }: {
      id?: string;
      name: string;
      description?: string | null;
      departmentId?: string | null;
      reportsToRoleId?: string | null;
      isActive?: boolean;
      permissionKeys?: string[];
    }) => {
      if (!id) return api<Role>("/master/roles", { method: "POST", body: { ...body, permissionKeys } });
      await api(`/master/roles/${id}`, { method: "PATCH", body });
      if (permissionKeys) await api(`/master/roles/${id}/permissions`, { method: "PUT", body: { permissionKeys } });
    },
    onSuccess: invalidate,
  });
}

export function useDeleteRole() {
  const invalidate = useInvalidateMaster();
  return useMutation({ mutationFn: (id: string) => api(`/master/roles/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export const usePermissionCatalog = () =>
  useQuery({ queryKey: k.catalog, queryFn: () => api<CatalogModule[]>("/master/permissions"), staleTime: 5 * 60_000 });

export const useOverrides = () => useQuery({ queryKey: k.overrides, queryFn: () => api<PermissionOverride[]>("/master/permissions/overrides") });

export function useSaveOverride() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: (body: { scopeType: OverrideScope; scopeId?: string; permissionKey: string; effect: "ALLOW" | "DENY"; note?: string }) =>
      api("/master/permissions/overrides", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteOverride() {
  const invalidate = useInvalidateMaster();
  return useMutation({ mutationFn: (id: string) => api(`/master/permissions/overrides/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export type AccessPreset = "DEFAULT" | "DENIED" | "VIEW_ONLY" | "FULL";

export function useApplyPreset() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: (body: { scopeType: OverrideScope; scopeId?: string; moduleKey: string; preset: AccessPreset; expiresAt?: string | null }) =>
      api("/master/permissions/presets", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

/** Module-by-module access for one person — what their menu shows. */
export const usePersonAccess = (userId: string) =>
  useQuery({
    queryKey: ["master", "access", "USER", userId],
    queryFn: () => api<ModuleAccess[]>("/master/permissions/access", { query: { scopeType: "USER", scopeId: userId } }),
  });

export function useExplain() {
  return useMutation({
    mutationFn: (q: { userId: string; action: string; teamId?: string; eventId?: string }) =>
      api<{ allowed: boolean; reason: string }>("/master/permissions/explain", { query: q }),
  });
}

export const useModules = () => useQuery({ queryKey: k.modules, queryFn: () => api<ModuleRow[]>("/master/modules") });

export function useUpdateModule() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: ({ key, status }: { key: string; status: Exclude<ModuleStatus, "PLANNED"> }) =>
      api(`/master/modules/${key}`, { method: "PATCH", body: { status } }),
    onSuccess: invalidate,
  });
}

export function useConfigureModule() {
  const invalidate = useInvalidateMaster();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, config }: { key: string; config: Record<string, unknown> }) =>
      api(`/master/modules/${key}`, { method: "PATCH", body: { config } }),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      void qc.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export const useSecurity = () => useQuery({ queryKey: k.security, queryFn: () => api<SecurityOverview>("/master/security") });

export function useUpdateSecurity() {
  const invalidate = useInvalidateMaster();
  return useMutation({
    mutationFn: (body: Partial<{ gatewayEnabled: boolean; mfaRequired: boolean; sessionMinutes: number }>) =>
      api("/master/security", { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useRotateCode() {
  const invalidate = useInvalidateMaster();
  return useMutation({ mutationFn: (code: string) => api("/master/security/code", { method: "POST", body: { code } }), onSuccess: invalidate });
}

export function useRevokePrivilege() {
  const invalidate = useInvalidateMaster();
  return useMutation({ mutationFn: (sessionId: string) => api(`/master/security/sessions/${sessionId}/revoke`, { method: "POST" }), onSuccess: invalidate });
}

export function useResetMfa() {
  const invalidate = useInvalidateMaster();
  return useMutation({ mutationFn: (userId: string) => api(`/master/security/mfa/${userId}/reset`, { method: "POST" }), onSuccess: invalidate });
}

export interface AuditFilters {
  action?: string;
  entityType?: string;
  cursor?: string;
}

export const useAudit = (filters: AuditFilters) =>
  useQuery({
    queryKey: k.audit(filters),
    queryFn: () => api<{ items: AuditEntry[]; nextCursor: string | null }>("/master/audit", { query: { ...filters, limit: 50 } }),
  });

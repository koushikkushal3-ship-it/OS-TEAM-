"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Ref } from "@/lib/api/types";

type Person = Ref & { avatarUrl: string | null };

function useInvalidate(...keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((queryKey) => void qc.invalidateQueries({ queryKey }));
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const useNotifications = (unread = false) =>
  useQuery({ queryKey: ["notifications", { unread }], queryFn: () => api<Notification[]>("/notifications", { query: { unread: unread ? "true" : undefined } }) });

export const useUnreadCount = () =>
  useQuery({ queryKey: ["notifications", "count"], queryFn: () => api<{ count: number }>("/notifications/unread-count"), refetchInterval: 60_000 });

export function useMarkRead() {
  const invalidate = useInvalidate(["notifications"]);
  return useMutation({ mutationFn: (id: string | "all") => api(id === "all" ? "/notifications/read-all" : `/notifications/${id}/read`, { method: "POST" }), onSuccess: invalidate });
}

// ── Announcements ────────────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  title: string;
  body: string;
  scopeType: "ORGANIZATION" | "DEPARTMENT" | "TEAM" | "EVENT";
  scopeId: string | null;
  tone: "info" | "warning" | "success";
  startsAt: string;
  endsAt: string | null;
}

export const useActiveAnnouncements = () =>
  useQuery({ queryKey: ["announcements", "active"], queryFn: () => api<Announcement[]>("/announcements/active"), staleTime: 5 * 60_000 });

// ── Kudos ────────────────────────────────────────────────────────────────────

export interface Kudos {
  id: string;
  message: string;
  createdAt: string;
  from: Person;
  to: Person;
}

export const useKudos = (userId?: string, enabled = true) =>
  useQuery({ queryKey: ["kudos", userId ?? "all"], queryFn: () => api<{ items: Kudos[]; received: number | null }>("/kudos", { query: { userId } }), enabled });

export function useGiveKudos() {
  const invalidate = useInvalidate(["kudos"]);
  return useMutation({ mutationFn: (body: { toId: string; message: string }) => api<Kudos>("/kudos", { method: "POST", body }), onSuccess: invalidate });
}

// ── Leave ────────────────────────────────────────────────────────────────────

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export interface LeaveRequest {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: Person;
  reviewedBy: Ref | null;
}

export const useLeave = (scope: "mine" | "team" | "all", status?: LeaveStatus) =>
  useQuery({ queryKey: ["leave", scope, status], queryFn: () => api<LeaveRequest[]>("/leave", { query: { scope, status } }) });

export function useLeaveActions() {
  const invalidate = useInvalidate(["leave"], ["workload"], ["calendar"]);
  return {
    request: useMutation({ mutationFn: (body: { type: string; startDate: string; endDate: string; reason?: string }) => api("/leave", { method: "POST", body }), onSuccess: invalidate }),
    review: useMutation({ mutationFn: ({ id, ...body }: { id: string; decision: "APPROVE" | "REJECT"; note?: string }) => api(`/leave/${id}/review`, { method: "POST", body }), onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: (id: string) => api(`/leave/${id}/cancel`, { method: "POST" }), onSuccess: invalidate }),
  };
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarEntry {
  id: string;
  kind: "task" | "meeting" | "shift" | "leave" | "event" | "run" | "schedule";
  title: string;
  start: string;
  end?: string | null;
  allDay?: boolean;
  location?: string | null;
  link: string;
}

export const useCalendar = (from: Date, to: Date) =>
  useQuery({
    queryKey: ["calendar", from.toISOString(), to.toISOString()],
    queryFn: () => api<CalendarEntry[]>("/calendar", { query: { from: from.toISOString(), to: to.toISOString() } }),
  });

export const useFeedToken = () => useQuery({ queryKey: ["calendar", "token"], queryFn: () => api<{ token: string | null }>("/calendar/feed-token") });

export function useRotateFeedToken() {
  const invalidate = useInvalidate(["calendar", "token"]);
  return useMutation({ mutationFn: () => api<{ token: string }>("/calendar/feed-token", { method: "POST" }), onSuccess: invalidate });
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchResults {
  people: (Person & { email: string })[];
  teams: Ref[];
  events: (Ref & { status: string })[];
  tasks: { id: string; title: string; status: string }[];
  meetings: { id: string; title: string; scheduledStart: string }[];
  tickets: { id: string; number: number; title: string; status: string }[];
  ideas: { id: string; title: string; status: string }[];
  files: Ref[];
}

export const useSearch = (q: string) =>
  useQuery({ queryKey: ["search", q], queryFn: () => api<SearchResults>("/search", { query: { q } }), enabled: q.trim().length >= 2, staleTime: 30_000 });

// ── Branding ─────────────────────────────────────────────────────────────────

export interface Branding {
  logoUrl: string | null;
  brandColor: string | null;
  loginMessage: string | null;
}

export const useBranding = () => useQuery({ queryKey: ["branding"], queryFn: () => api<Branding>("/platform/branding"), staleTime: 10 * 60_000 });

// ── Performance ──────────────────────────────────────────────────────────────

export interface MyPerformance {
  score: number | null;
  breakdown: { completion: number | null; deadlines: number | null; updates: number | null; attendance: number | null };
  weights: { completion: number; deadlines: number; updates: number; attendance: number };
  work: { tasksTotal: number; tasksCompleted: number; tasksOnTime: number; tasksActive: number; tasksWithRecentUpdate: number; meetingsTotal: number; meetingsAttended: number };
}

export const useMyPerformance = () => useQuery({ queryKey: ["reports", "me"], queryFn: () => api<MyPerformance>("/reports/me") });

export function useExportSheet() {
  return useMutation({ mutationFn: (kind: "people" | "weekly") => api<{ name: string; url: string }>("/reports/export-sheet", { method: "POST", body: { kind } }) });
}

// ── Shifts & run of show ─────────────────────────────────────────────────────

export interface Shift {
  id: string;
  eventId: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  notes: string | null;
  assignments: { userId: string; user: Person }[];
  event?: Ref;
}

export interface ShiftInput {
  title: string;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  notes?: string | null;
}

export const useEventShifts = (eventId: string) =>
  useQuery({ queryKey: ["shifts", eventId], queryFn: () => api<{ shifts: Shift[]; capabilities: { canManage: boolean; canSignup: boolean } }>(`/events/${eventId}/shifts`), retry: false });

export const useUpcomingShifts = () => useQuery({ queryKey: ["shifts", "upcoming"], queryFn: () => api<Shift[]>("/shifts/upcoming") });

export function useShiftActions(eventId?: string) {
  const invalidate = useInvalidate(["shifts"], ["calendar"], ["workload"]);
  return {
    save: useMutation({
      mutationFn: ({ id, ...body }: ShiftInput & { id?: string }) =>
        id ? api(`/shifts/${id}`, { method: "PATCH", body }) : api(`/events/${eventId}/shifts`, { method: "POST", body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/shifts/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
    signup: useMutation({ mutationFn: ({ id, join }: { id: string; join: boolean }) => api(`/shifts/${id}/signup`, { method: join ? "POST" : "DELETE" }), onSuccess: invalidate }),
    assign: useMutation({
      mutationFn: ({ id, userId, add }: { id: string; userId: string; add: boolean }) =>
        add ? api(`/shifts/${id}/assign`, { method: "POST", body: { userId } }) : api(`/shifts/${id}/assign/${userId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

export interface RunItem {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  notes: string | null;
  doneAt: string | null;
  owner: Person | null;
}

export const useRunOfShow = (eventId: string) =>
  useQuery({ queryKey: ["run", eventId], queryFn: () => api<{ items: RunItem[]; capabilities: { canManage: boolean } }>(`/events/${eventId}/run`) });

export function useRunActions(eventId: string) {
  const invalidate = useInvalidate(["run", eventId], ["calendar"]);
  return {
    add: useMutation({ mutationFn: (body: { title: string; startsAt: string; endsAt?: string | null; ownerId?: string | null; notes?: string | null }) => api(`/events/${eventId}/run`, { method: "POST", body }), onSuccess: invalidate }),
    toggle: useMutation({ mutationFn: ({ id, done }: { id: string; done: boolean }) => api(`/run-items/${id}`, { method: "PATCH", body: { done } }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api(`/run-items/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export function useDuplicateEvent(eventId: string) {
  const invalidate = useInvalidate(["events"]);
  return useMutation({
    mutationFn: (body: { name: string; startDate?: string | null; copyTasks: boolean; copyBudgets: boolean; copyShifts: boolean; copyRunOfShow: boolean }) =>
      api<{ id: string }>(`/events/${eventId}/duplicate`, { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export interface BudgetHealth {
  id: string;
  name: string;
  event: Ref | null;
  team: Ref | null;
  amount: number;
  spent: number;
  pending: number;
  percent: number;
  state: "ok" | "warning" | "over";
}

export const useBudgetHealth = (eventId?: string, enabled = true) =>
  useQuery({ queryKey: ["finance", "budget-health", eventId ?? "all"], queryFn: () => api<BudgetHealth[]>("/finance/budget-health", { query: { eventId } }), enabled });

export interface WorkloadRow {
  person: Person & { department: { name: string } | null };
  openTasks: number;
  overdue: number;
  dueThisWeek: number;
  openTickets: number;
  shiftsThisWeek: number;
  leave: { startDate: string; endDate: string; type: string } | null;
  load: number;
  state: "light" | "busy" | "heavy" | "away";
}

export const useWorkload = (teamId?: string) =>
  useQuery({ queryKey: ["workload", teamId ?? "all"], queryFn: () => api<WorkloadRow[]>("/workload", { query: { teamId } }) });

// ── Master control ───────────────────────────────────────────────────────────

const M = "/master/control";

function useMasterInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["control"] });
    void qc.invalidateQueries({ queryKey: ["master"] });
    void qc.invalidateQueries({ queryKey: ["people"] });
  };
}

export function useViewAs() {
  return useMutation({ mutationFn: (userId: string) => api<{ viewing: Ref; minutes: number }>(`${M}/view-as/${userId}`, { method: "POST" }) });
}

export function useExitViewAs() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api("/view-as", { method: "DELETE" }), onSuccess: () => qc.clear() });
}

export interface AccessMap {
  modules: { key: string; name: string; isCore: boolean }[];
  rows: { person: Ref & { email: string; status: string; department: { name: string } | null }; cells: Record<string, { visible: boolean; personal: string; expiresAt: string | null }> }[];
}
export const useAccessMap = () => useQuery({ queryKey: ["control", "access-map"], queryFn: () => api<AccessMap>(`${M}/access-map`) });

export interface LoginHistory {
  entries: { id: string; action: string; at: string; ip: string | null; device: string; actor: (Ref & { email: string }) | null }[];
  sessions: { id: string; ip: string | null; device: string; createdAt: string; lastSeenAt: string; impersonatorId: string | null; privilegedUntil: string | null; current: boolean; user: Ref }[];
}
export const useLogins = (userId?: string) => useQuery({ queryKey: ["control", "logins", userId ?? "all"], queryFn: () => api<LoginHistory>(`${M}/logins`, { query: { userId } }) });

export interface SecurityAlert {
  kind: "FAILED_GATEWAY" | "NEW_DEVICE" | "BULK_DOWNLOAD" | "MASTER_GRANTED";
  severity: "high" | "medium";
  actorId: string | null;
  actorName: string | null;
  message: string;
  at: string;
  count: number;
}
export const useAlerts = (days = 7) => useQuery({ queryKey: ["control", "alerts", days], queryFn: () => api<SecurityAlert[]>(`${M}/alerts`, { query: { days } }) });

export interface SystemHealth {
  database: { bytes: number; limitBytes: number; tables: { name: string; rows: number; bytes: number }[] };
  people: { active: number; invited: number; disabled: number; googleTestUserCap: number; signInCapable: number };
  drive: { connected: boolean; email: string | null; usageBytes: number | null; limitBytes: number | null };
  storage: { provider: "database" | "supabase"; fileLimitMb: number | null };
  backups: { enabled: boolean; everyDays: number; lastAt: string | null; lastError: string | null };
  automation: { rules: number; enabled: number; lastRunAt: string | null };
  pendingApprovals: number;
  recycleBin: number;
  maintenance: { enabled: boolean; message: string };
}
export const useHealth = () => useQuery({ queryKey: ["control", "health"], queryFn: () => api<SystemHealth>(`${M}/health`) });

export interface BackupSettings {
  enabled: boolean;
  everyDays: number;
  lastAt: string | null;
  lastError: string | null;
  history: { at: string; name: string; url: string | null; key?: string; provider?: string; tables: number; rows: number; bytes: number; by: string | null }[];
}
export const useBackups = () => useQuery({ queryKey: ["control", "backups"], queryFn: () => api<BackupSettings>(`${M}/backups`) });

export interface BinItem {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  deletedAt: string;
  purgeAt: string;
  reviewedAt: string | null;
  deletedBy: (Ref & { email: string }) | null;
  reviewedBy: Ref | null;
}
export const useBin = (view: "review" | "ignored") =>
  useQuery({ queryKey: ["control", "bin", view], queryFn: () => api<{ counts: { review: number; ignored: number }; items: BinItem[] }>(`${M}/bin`, { query: { view } }) });
export const useBinCount = () => useQuery({ queryKey: ["control", "bin", "count"], queryFn: () => api<{ review: number }>(`${M}/bin/count`), refetchInterval: 60_000 });

export interface MaintenanceSetting {
  enabled: boolean;
  message: string;
  people: { userId: string; name: string; message: string; since: string }[];
}
export const useMaintenanceSetting = () => useQuery({ queryKey: ["control", "maintenance"], queryFn: () => api<MaintenanceSetting>(`${M}/maintenance`) });

export interface ChangeRequest {
  id: string;
  kind: string;
  summary: string;
  status: "PENDING" | "EXECUTED" | "REJECTED" | "CANCELLED";
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  requestedBy: Ref | null;
  decidedBy: Ref | null;
  canDecide: boolean;
  canCancel: boolean;
}
export const useApprovals = () => useQuery({ queryKey: ["control", "approvals"], queryFn: () => api<ChangeRequest[]>(`${M}/approvals`) });

export interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  config: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  description: string;
  _count: { firings: number };
}
export const useAutomations = () =>
  useQuery({ queryKey: ["control", "automations"], queryFn: () => api<{ triggers: { key: string; label: string }[]; rules: AutomationRule[] }>(`${M}/automations`) });

export const useMasterAnnouncements = () => useQuery({ queryKey: ["control", "announcements"], queryFn: () => api<Announcement[]>(`${M}/announcements`) });
export const useMasterBranding = () => useQuery({ queryKey: ["control", "branding"], queryFn: () => api<Branding>(`${M}/branding`) });

/** Every Master control mutation, invalidating the console and people lists. */
export function useControl() {
  const invalidate = useMasterInvalidate();
  const qc = useQueryClient();
  const useM = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: invalidate });
  return {
    signOut: useM((id: string) => api<{ sessions: number }>(`${M}/people/${id}/sign-out`, { method: "POST" })),
    offboard: useM(({ id, reassignToId }: { id: string; reassignToId: string | null }) => api<Record<string, number>>(`${M}/people/${id}/offboard`, { method: "POST", body: { reassignToId } })),
    bulkInvite: useM((body: { csv: string; dryRun: boolean }) => api<{ dryRun: boolean; ready?: number; created?: number; problems: { line: number; message: string }[]; credentials?: { name: string; email: string; password: string }[] }>(`${M}/people/bulk-invite`, { method: "POST", body })),
    maintenance: useMutation({
      mutationFn: (body: { enabled: boolean; message: string }) => api(`${M}/maintenance`, { method: "PUT", body }),
      onSuccess: () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ["auth", "me"] });
      },
    }),
    branding: useMutation({
      mutationFn: (body: Branding) => api(`${M}/branding`, { method: "PUT", body }),
      onSuccess: () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ["branding"] });
      },
    }),
    restore: useM((id: string) => api(`${M}/bin/${id}/restore`, { method: "POST" })),
    addPerson: useM((body: { name: string; email: string; password: string; departmentId: string | null; roleId: string | null; mustChangePassword: boolean }) =>
      api<{ id: string; email: string; name: string }>(`${M}/people`, { method: "POST", body }),
    ),
    setPassword: useM(({ id, ...body }: { id: string; password: string; mustChangePassword: boolean }) => api(`${M}/people/${id}/password`, { method: "POST", body })),
    ignore: useM((id: string) => api(`${M}/bin/${id}/ignore`, { method: "POST" })),
    purge: useM((id: string) => api(`${M}/bin/${id}`, { method: "DELETE" })),
    addMaintenancePerson: useM((body: { userId: string; message: string }) => api(`${M}/maintenance/people`, { method: "POST", body })),
    removeMaintenancePerson: useM((userId: string) => api(`${M}/maintenance/people/${userId}`, { method: "DELETE" })),
    backupSettings: useM((body: { enabled: boolean; everyDays: number }) => api(`${M}/backups`, { method: "PUT", body })),
    runBackup: useM(() => api<{ name: string; url: string | null }>(`${M}/backups/run`, { method: "POST" })),
    decide: useM(({ id, decision }: { id: string; decision: "approve" | "reject" | "cancel" }) => api(`${M}/approvals/${id}/${decision}`, { method: "POST" })),
    revert: useMutation({
      mutationFn: (auditId: string) => api(`${M}/audit/${auditId}/revert`, { method: "POST" }),
      onSuccess: () => {
        invalidate();
        void qc.invalidateQueries({ queryKey: ["auth", "me"] });
      },
    }),
    saveAnnouncement: useM(({ id, ...body }: Partial<Announcement> & { id?: string }) => (id ? api(`${M}/announcements/${id}`, { method: "PATCH", body }) : api(`${M}/announcements`, { method: "POST", body }))),
    deleteAnnouncement: useM((id: string) => api(`${M}/announcements/${id}`, { method: "DELETE" })),
    saveRule: useM(({ id, ...body }: { id?: string; name?: string; trigger?: string; config?: Record<string, unknown>; enabled?: boolean }) =>
      id ? api(`${M}/automations/${id}`, { method: "PATCH", body }) : api(`${M}/automations`, { method: "POST", body }),
    ),
    deleteRule: useM((id: string) => api(`${M}/automations/${id}`, { method: "DELETE" })),
    runRule: useM((id: string) => api(`${M}/automations/${id}/run`, { method: "POST" })),
  };
}

/** A Master Admin change that must wait for a second approver comes back like this. */
export const isPendingApproval = (v: unknown): v is { pendingApproval: true; requestId: string } =>
  typeof v === "object" && v !== null && (v as { pendingApproval?: boolean }).pendingApproval === true;

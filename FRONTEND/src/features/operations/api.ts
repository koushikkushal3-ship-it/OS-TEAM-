"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type {
  Budget,
  DriveStatus,
  Expense,
  ExpenseDetail,
  ExpenseStatus,
  FileAttachment,
  FinanceSummary,
  Idea,
  IdeaDetail,
  IdeaStats,
  IdeaStatus,
  Opportunity,
  OpportunityDetail,
  OpportunityStats,
  OpportunityStatus,
  OpportunityType,
  PaymentMethod,
  Ticket,
  TicketDetail,
  TicketPriority,
  TicketStats,
  TicketStatus,
} from "@/lib/api/types";

/** Everything Phase 4 touches, so one save refreshes the right screens. */
function useInvalidateOperations() {
  const qc = useQueryClient();
  return (...keys: string[]) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

// ── Files (Google Drive) ─────────────────────────────────────────────────────

export type FileEntity = "expense" | "idea" | "ticket" | "opportunity" | "meeting" | "task" | "event";

export const useFiles = (entityType: FileEntity, entityId: string, enabled = true) =>
  useQuery({
    queryKey: ["files", entityType, entityId],
    queryFn: () => api<FileAttachment[]>("/files", { query: { entityType, entityId } }),
    enabled,
  });

export function useUploadFile(entityType: FileEntity, entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind?: string }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", entityId);
      if (kind) form.append("kind", kind);

      // FormData must not go through the JSON client.
      const res = await fetch("/api/files", { method: "POST", credentials: "include", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? `Upload failed (${res.status})`);
      }
      return (await res.json()) as FileAttachment;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["files", entityType, entityId] }),
  });
}

export function useDeleteFile(entityType: FileEntity, entityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/files/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["files", entityType, entityId] }),
  });
}

export const useDriveStatus = (enabled = true) =>
  useQuery({ queryKey: ["master", "drive"], queryFn: () => api<DriveStatus>("/integrations/google-drive"), enabled, retry: false });

export function useDisconnectDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/integrations/google-drive/disconnect", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["master", "drive"] }),
  });
}

// ── Finance ──────────────────────────────────────────────────────────────────

export const useFinanceSummary = (filter: { eventId?: string; teamId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ["finance", "summary", filter], queryFn: () => api<FinanceSummary>("/finance/summary", { query: filter }), enabled });

export const useBudgets = (filter: { eventId?: string; teamId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ["finance", "budgets", filter], queryFn: () => api<Budget[]>("/finance/budgets", { query: filter }), enabled });

export interface BudgetInput {
  name: string;
  amount: number;
  eventId?: string | null;
  teamId?: string | null;
  notes?: string | null;
}

export function useSaveBudget() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ id, ...body }: BudgetInput & { id?: string }) =>
      id ? api(`/finance/budgets/${id}`, { method: "PATCH", body }) : api("/finance/budgets", { method: "POST", body }),
    onSuccess: () => invalidate("finance"),
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidateOperations();
  return useMutation({ mutationFn: (id: string) => api(`/finance/budgets/${id}`, { method: "DELETE" }), onSuccess: () => invalidate("finance") });
}

export const useExpenses = (filter: { eventId?: string; teamId?: string; status?: ExpenseStatus; mine?: boolean } = {}) =>
  useQuery({
    queryKey: ["finance", "expenses", filter],
    queryFn: () =>
      api<Expense[]>("/finance/expenses", {
        query: { eventId: filter.eventId, teamId: filter.teamId, status: filter.status, mine: filter.mine ? "true" : undefined },
      }),
  });

export const useExpense = (id: string) =>
  useQuery({ queryKey: ["finance", "expense", id], queryFn: () => api<ExpenseDetail>(`/finance/expenses/${id}`) });

export interface ExpenseInput {
  title: string;
  category: string;
  amount: number;
  eventId?: string | null;
  teamId?: string | null;
  budgetId?: string | null;
  paidById?: string | null;
  paymentMethod: PaymentMethod;
  spentAt: string;
  description?: string | null;
}

export function useSaveExpense() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<ExpenseInput> & { id?: string }) =>
      id ? api<Expense>(`/finance/expenses/${id}`, { method: "PATCH", body }) : api<Expense>("/finance/expenses", { method: "POST", body }),
    onSuccess: () => invalidate("finance"),
  });
}

export function useReviewExpense(id: string) {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ decision, note }: { decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES"; note?: string }) =>
      api(`/finance/expenses/${id}/review`, { method: "POST", body: { decision, note } }),
    onSuccess: () => invalidate("finance"),
  });
}

export function useReimburseExpense(id: string) {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: (reference?: string) => api(`/finance/expenses/${id}/reimburse`, { method: "POST", body: { reference } }),
    onSuccess: () => invalidate("finance"),
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateOperations();
  return useMutation({ mutationFn: (id: string) => api(`/finance/expenses/${id}`, { method: "DELETE" }), onSuccess: () => invalidate("finance") });
}

// ── Tickets ──────────────────────────────────────────────────────────────────

export const useTickets = (filter: { status?: TicketStatus; open?: boolean; mine?: boolean; teamId?: string; eventId?: string } = {}) =>
  useQuery({
    queryKey: ["tickets", "list", filter],
    queryFn: () =>
      api<Ticket[]>("/tickets", {
        query: {
          status: filter.status,
          open: filter.open ? "true" : undefined,
          mine: filter.mine ? "true" : undefined,
          teamId: filter.teamId,
          eventId: filter.eventId,
        },
      }),
  });

export const useTicket = (id: string) => useQuery({ queryKey: ["tickets", id], queryFn: () => api<TicketDetail>(`/tickets/${id}`) });

export const useTicketStats = (filter: { teamId?: string; eventId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ["tickets", "stats", filter], queryFn: () => api<TicketStats>("/tickets/stats", { query: filter }), enabled });

export interface TicketInput {
  title: string;
  description?: string | null;
  priority: TicketPriority;
  teamId?: string | null;
  eventId?: string | null;
  assigneeId?: string | null;
  status?: TicketStatus;
  resolution?: string | null;
}

export function useSaveTicket() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<TicketInput> & { id?: string }) =>
      id ? api<Ticket>(`/tickets/${id}`, { method: "PATCH", body }) : api<Ticket>("/tickets", { method: "POST", body }),
    onSuccess: () => invalidate("tickets"),
  });
}

export function useCommentTicket(id: string) {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: (message: string) => api(`/tickets/${id}/comments`, { method: "POST", body: { message } }),
    onSuccess: () => invalidate("tickets"),
  });
}

export function useDeleteTicket() {
  const invalidate = useInvalidateOperations();
  return useMutation({ mutationFn: (id: string) => api(`/tickets/${id}`, { method: "DELETE" }), onSuccess: () => invalidate("tickets") });
}

// ── Ideas ────────────────────────────────────────────────────────────────────

export const useIdeas = (filter: { status?: IdeaStatus; mine?: boolean; eventId?: string } = {}) =>
  useQuery({
    queryKey: ["ideas", "list", filter],
    queryFn: () => api<Idea[]>("/ideas", { query: { status: filter.status, mine: filter.mine ? "true" : undefined, eventId: filter.eventId } }),
  });

export const useIdea = (id: string) => useQuery({ queryKey: ["ideas", id], queryFn: () => api<IdeaDetail>(`/ideas/${id}`) });

export const useIdeaStats = (enabled = true) =>
  useQuery({ queryKey: ["ideas", "stats"], queryFn: () => api<IdeaStats>("/ideas/stats"), enabled });

export interface IdeaInput {
  title: string;
  category: string;
  summary: string;
  eventId?: string | null;
  teamId?: string | null;
}

export function useSaveIdea() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<IdeaInput> & { id?: string }) =>
      id ? api<Idea>(`/ideas/${id}`, { method: "PATCH", body }) : api<Idea>("/ideas", { method: "POST", body }),
    onSuccess: () => invalidate("ideas"),
  });
}

export function useReviewIdea(id: string) {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ status, note }: { status: IdeaStatus; note?: string }) =>
      api(`/ideas/${id}/review`, { method: "POST", body: { status, note } }),
    onSuccess: () => invalidate("ideas"),
  });
}

export function useDeleteIdea() {
  const invalidate = useInvalidateOperations();
  return useMutation({ mutationFn: (id: string) => api(`/ideas/${id}`, { method: "DELETE" }), onSuccess: () => invalidate("ideas") });
}

// ── Opportunities ────────────────────────────────────────────────────────────

export const useOpportunities = (filter: { type?: OpportunityType; status?: OpportunityStatus; eventId?: string; mine?: boolean } = {}) =>
  useQuery({
    queryKey: ["opportunities", "list", filter],
    queryFn: () =>
      api<Opportunity[]>("/opportunities", {
        query: { type: filter.type, status: filter.status, eventId: filter.eventId, mine: filter.mine ? "true" : undefined },
      }),
  });

export const useOpportunity = (id: string) =>
  useQuery({ queryKey: ["opportunities", id], queryFn: () => api<OpportunityDetail>(`/opportunities/${id}`) });

export const useOpportunityStats = (filter: { eventId?: string } = {}, enabled = true) =>
  useQuery({ queryKey: ["opportunities", "stats", filter], queryFn: () => api<OpportunityStats>("/opportunities/stats", { query: filter }), enabled });

export interface OpportunityInput {
  type: OpportunityType;
  name: string;
  organizationName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  description?: string | null;
  value?: number | null;
  eventId?: string | null;
  teamId?: string | null;
  ownerId?: string | null;
  nextActionAt?: string | null;
  status?: OpportunityStatus;
}

export function useSaveOpportunity() {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<OpportunityInput> & { id?: string }) =>
      id
        ? api<Opportunity>(`/opportunities/${id}`, { method: "PATCH", body })
        : api<Opportunity>("/opportunities", { method: "POST", body }),
    onSuccess: () => invalidate("opportunities"),
  });
}

export function useAddOpportunityActivity(id: string) {
  const invalidate = useInvalidateOperations();
  return useMutation({
    mutationFn: ({ message, kind }: { message: string; kind: "note" | "call" | "email" | "meeting" }) =>
      api(`/opportunities/${id}/activity`, { method: "POST", body: { message, kind } }),
    onSuccess: () => invalidate("opportunities"),
  });
}

export function useDeleteOpportunity() {
  const invalidate = useInvalidateOperations();
  return useMutation({ mutationFn: (id: string) => api(`/opportunities/${id}`, { method: "DELETE" }), onSuccess: () => invalidate("opportunities") });
}

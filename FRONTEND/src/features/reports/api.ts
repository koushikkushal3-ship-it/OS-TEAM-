"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Ref } from "@/lib/api/types";

export interface ScoreBreakdown {
  completion: number | null;
  deadlines: number | null;
  updates: number | null;
  attendance: number | null;
}

export interface Score {
  score: number | null;
  breakdown: ScoreBreakdown;
  weights: { completion: number; deadlines: number; updates: number; attendance: number };
}

export interface WorkSignals {
  tasksTotal: number;
  tasksCompleted: number;
  tasksOnTime: number;
  tasksActive: number;
  tasksWithRecentUpdate: number;
  meetingsTotal: number;
  meetingsAttended: number;
}

export interface FinanceTotals {
  allocated: number;
  spent: number;
  pending: number;
  remaining: number;
  byStatus: Record<string, { count: number; amount: number }>;
}

export interface OrganizationReport extends Score {
  generatedAt: string;
  performance: Score;
  work: WorkSignals;
  people: Record<string, number>;
  teams: number;
  events: Record<string, number>;
  tickets: Record<string, number>;
  ideas: Record<string, number>;
  opportunities: Record<string, number>;
  finance: FinanceTotals | null;
}

export interface TeamPerformanceRow extends Score {
  team: Ref;
  members: number;
  leads: (Ref & { memberRole: string })[];
  work: WorkSignals;
}

export interface PersonPerformanceRow extends Score {
  person: Ref & { avatarUrl: string | null };
  work: WorkSignals;
}

export interface ActivityReport {
  from: string;
  to: string;
  tasksCreated: number;
  tasksCompleted: number;
  workUpdates: number;
  meetingsHeld: number;
  expensesSubmitted: number;
  ticketsOpened: number;
  ticketsResolved: number;
  ideasSubmitted: number;
}

export interface EventReport {
  generatedAt: string;
  event: Ref & {
    status: string;
    startDate: string | null;
    endDate: string | null;
    venue: string | null;
    owner: Ref | null;
    teams: { team: Ref & { _count: { members: number } } }[];
    _count: { members: number };
  };
  performance: Score;
  work: WorkSignals;
  teams: TeamPerformanceRow[];
  meetings: Record<string, number>;
  tickets: Record<string, number>;
  opportunities: { type: string; status: string; count: number }[];
  ideas: number;
  finance: FinanceTotals | null;
}

export const useOrganizationReport = (enabled = true) =>
  useQuery({ queryKey: ["reports", "organization"], queryFn: () => api<OrganizationReport>("/reports/organization"), enabled });

export const useTeamPerformance = (eventId?: string, enabled = true) =>
  useQuery({
    queryKey: ["reports", "performance", eventId],
    queryFn: () => api<TeamPerformanceRow[]>("/reports/performance", { query: { eventId } }),
    enabled,
  });

export const usePeoplePerformance = (filter: { teamId?: string; eventId?: string } = {}, enabled = true) =>
  useQuery({
    queryKey: ["reports", "people", filter],
    queryFn: () => api<PersonPerformanceRow[]>("/reports/people", { query: filter }),
    enabled,
  });

export const useActivityReport = (days: number, enabled = true) =>
  useQuery({
    queryKey: ["reports", "activity", days],
    queryFn: () =>
      api<ActivityReport>("/reports/activity", {
        query: { from: new Date(Date.now() - days * 86_400_000).toISOString() },
      }),
    enabled,
  });

export const useEventReport = (eventId: string, enabled = true) =>
  useQuery({ queryKey: ["reports", "event", eventId], queryFn: () => api<EventReport>(`/reports/event/${eventId}`), enabled });

/** Turns any report table into a CSV file the browser downloads. */
export function downloadCsv(filename: string, rows: Record<string, string | number | null>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number | null) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

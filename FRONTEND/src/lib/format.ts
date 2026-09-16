import type { EventStatus, TeamMemberRole, UserStatus } from "./api/types";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const formatDate = (d?: string | null) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatDateTime = (d?: string | null) => (d ? dateTimeFmt.format(new Date(d)) : "—");

export function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return "Dates not set";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end);
}

export const formatMoney = (v?: string | number | null) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v));

export const memberRoleLabel: Record<TeamMemberRole, string> = { LEAD: "Lead", CO_LEAD: "Co-Lead", MEMBER: "Member" };

export const eventStatusTone: Record<EventStatus, "brand" | "ok" | "neutral" | "warn"> = {
  PLANNING: "warn",
  ACTIVE: "ok",
  COMPLETED: "brand",
  ARCHIVED: "neutral",
};

export const userStatusTone: Record<UserStatus, "ok" | "warn" | "danger"> = { ACTIVE: "ok", INVITED: "warn", DISABLED: "danger" };

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

/** For <input type="date"> values. */
export const toDateInput = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** "permission.access_changed" → "Permission access changed" */
export const describeAction = (action: string) => action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ── Phase 2 — work ───────────────────────────────────────────

import type { TaskPriority, TaskStatus } from "./api/types";

export const taskStatusLabel: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  IN_REVIEW: "In review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const taskStatusTone: Record<TaskStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  BACKLOG: "neutral",
  ASSIGNED: "brand",
  IN_PROGRESS: "brand",
  BLOCKED: "danger",
  IN_REVIEW: "warn",
  COMPLETED: "ok",
  CANCELLED: "neutral",
};

export const priorityTone: Record<TaskPriority, "neutral" | "brand" | "warn" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "brand",
  HIGH: "warn",
  URGENT: "danger",
};

export const OPEN_TASK_STATUSES: TaskStatus[] = ["BACKLOG", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];

/** Due-date wording relative to today. */
export function dueLabel(due?: string | null) {
  if (!due) return { text: "No due date", tone: "neutral" as const };
  const days = Math.ceil((new Date(due).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "danger" as const };
  if (days === 0) return { text: "Due today", tone: "warn" as const };
  if (days === 1) return { text: "Due tomorrow", tone: "warn" as const };
  if (days <= 7) return { text: `Due in ${days}d`, tone: "neutral" as const };
  return { text: formatDate(due), tone: "neutral" as const };
}

// ── Phase 3 — meetings & attendance ──────────────────────────

import type { AttendanceStatus, MeetingStatus, MeetingType } from "./api/types";

export const meetingTypeLabel: Record<MeetingType, string> = {
  GOOGLE_MEET: "Google Meet",
  INTERNAL: "Internal",
  PHYSICAL: "Physical",
  WORKSHOP: "Workshop",
  ONE_TO_ONE: "One-to-one",
  EXTERNAL: "External",
  EVENT: "Event meeting",
  CUSTOM: "Custom",
};

export const meetingStatusTone: Record<MeetingStatus, "neutral" | "brand" | "ok" | "warn"> = {
  SCHEDULED: "brand",
  LIVE: "ok",
  ENDED: "neutral",
  CANCELLED: "warn",
};

export const attendanceLabel: Record<AttendanceStatus, string> = {
  UNKNOWN: "Not recorded",
  PRESENT: "Present",
  LATE: "Late",
  PARTIAL: "Partial",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

export const attendanceTone: Record<AttendanceStatus, "neutral" | "ok" | "warn" | "danger" | "brand"> = {
  UNKNOWN: "neutral",
  PRESENT: "ok",
  LATE: "warn",
  PARTIAL: "warn",
  ABSENT: "danger",
  EXCUSED: "brand",
};

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" });
export const formatTime = (d?: string | null) => (d ? timeFmt.format(new Date(d)) : "—");

export function formatMeetingWhen(start: string, end: string) {
  return `${formatDate(start)}, ${formatTime(start)} – ${formatTime(end)}`;
}

export const durationLabel = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** Value for an <input type="datetime-local"> */
export const toDateTimeInput = (d?: string | null) => {
  if (!d) return "";
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// ── Phase 4 — operations ─────────────────────────────────────

import type { ExpenseStatus, IdeaStatus, OpportunityStatus, OpportunityType, TicketStatus } from "./api/types";

export const expenseStatusLabel: Record<ExpenseStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REIMBURSED: "Reimbursed",
};

export const expenseStatusTone: Record<ExpenseStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "brand",
  UNDER_REVIEW: "warn",
  APPROVED: "ok",
  REJECTED: "danger",
  REIMBURSED: "ok",
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const ticketStatusTone: Record<TicketStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  OPEN: "brand",
  ASSIGNED: "brand",
  IN_PROGRESS: "brand",
  BLOCKED: "danger",
  RESOLVED: "ok",
  CLOSED: "neutral",
};

export const ideaStatusLabel: Record<IdeaStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  IMPLEMENTING: "Implementing",
  IMPLEMENTED: "Implemented",
};

export const ideaStatusTone: Record<IdeaStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  SUBMITTED: "brand",
  UNDER_REVIEW: "warn",
  ACCEPTED: "ok",
  REJECTED: "danger",
  IMPLEMENTING: "brand",
  IMPLEMENTED: "ok",
};

export const opportunityTypeLabel: Record<OpportunityType, string> = {
  SPONSOR: "Sponsor",
  GUEST: "Guest",
  VENDOR: "Vendor",
  VENUE: "Venue",
  COLLABORATION: "Collaboration",
  INVITATION: "Invitation",
  PARTNER: "Partner",
};

export const opportunityStatusLabel: Record<OpportunityStatus, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under review",
  CONTACTED: "Contacted",
  NEGOTIATING: "Negotiating",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

export const opportunityStatusTone: Record<OpportunityStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  NEW: "neutral",
  UNDER_REVIEW: "warn",
  CONTACTED: "brand",
  NEGOTIATING: "warn",
  CONFIRMED: "ok",
  REJECTED: "danger",
  CLOSED: "neutral",
};

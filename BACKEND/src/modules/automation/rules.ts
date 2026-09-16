import { z } from 'zod';

/**
 * Automation rules Master Admin can switch on. Each trigger has a small, explicit
 * config — no free-form scripting, so every rule stays explainable in one sentence.
 */
export const TRIGGERS = {
  TASK_OVERDUE: {
    label: 'Task overdue',
    describe: (c: { days: number }) => `When a task is ${c.days} day(s) past due, alert the assignee and their team leads.`,
    schema: z.object({ days: z.coerce.number().int().min(0).max(60) }),
  },
  TICKET_STALE: {
    label: 'Ticket left open',
    describe: (c: { hours: number }) => `When a ticket stays open for ${c.hours} hour(s), alert the assignee (or the requester's leads).`,
    schema: z.object({ hours: z.coerce.number().int().min(1).max(24 * 30) }),
  },
  BUDGET_THRESHOLD: {
    label: 'Budget nearly spent',
    describe: (c: { percent: number }) => `When a budget reaches ${c.percent}% spent, alert the event owner and the budget creator.`,
    schema: z.object({ percent: z.coerce.number().int().min(1).max(100) }),
  },
  EXPENSE_TWO_APPROVERS: {
    label: 'Two approvers for large expenses',
    describe: (c: { minAmount: number }) => `Expenses of ₹${c.minAmount.toLocaleString('en-IN')} or more need two different approvers.`,
    schema: z.object({ minAmount: z.coerce.number().min(0) }),
  },
  WEEKLY_REPORT: {
    label: 'Weekly report',
    describe: () => 'Every 7 days, save an organization report (to Google Sheets when Drive is connected) and notify report viewers.',
    schema: z.object({}).passthrough(),
  },
} as const;

export type Trigger = keyof typeof TRIGGERS;
export const TRIGGER_KEYS = Object.keys(TRIGGERS) as Trigger[];

export function parseConfig<T extends Trigger>(trigger: T, config: unknown): z.infer<(typeof TRIGGERS)[T]['schema']> {
  return TRIGGERS[trigger].schema.parse(config ?? {}) as z.infer<(typeof TRIGGERS)[T]['schema']>;
}

export function describeRule(trigger: Trigger, config: unknown): string {
  const parsed = TRIGGERS[trigger].schema.safeParse(config ?? {});
  if (!parsed.success) return TRIGGERS[trigger].label;
  return (TRIGGERS[trigger].describe as (c: unknown) => string)(parsed.data);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A task is overdue for the rule once its due date is `days` full days behind `now`. */
export function isTaskOverdue(task: { dueDate: Date | null; status: string }, days: number, now: Date) {
  if (!task.dueDate || ['COMPLETED', 'CANCELLED'].includes(task.status)) return false;
  return now.getTime() - task.dueDate.getTime() >= days * DAY;
}

export function isTicketStale(ticket: { createdAt: Date; status: string }, hours: number, now: Date) {
  if (['RESOLVED', 'CLOSED'].includes(ticket.status)) return false;
  return now.getTime() - ticket.createdAt.getTime() >= hours * HOUR;
}

export function budgetPercent(spent: number, amount: number) {
  if (amount <= 0) return spent > 0 ? 100 : 0;
  return Math.round((spent / amount) * 100);
}

export function isDue(lastRunAt: Date | null | undefined, everyDays: number, now: Date) {
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= everyDays * DAY;
}

/** RFC 4180 CSV. Cells starting with = + - @ are prefixed so a spreadsheet never runs them as formulas. */
export function toCsv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Meetings starting within the reminder window and not yet started. */
export function needsReminder(meeting: { scheduledStart: Date; status: string }, minutes: number, now: Date) {
  if (meeting.status !== 'SCHEDULED') return false;
  const until = meeting.scheduledStart.getTime() - now.getTime();
  return until > 0 && until <= minutes * 60_000;
}

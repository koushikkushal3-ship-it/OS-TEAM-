import { budgetPercent, describeRule, isDue, isTaskOverdue, isTicketStale, needsReminder, parseConfig, toCsv } from './rules.js';

const now = new Date('2026-09-20T10:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('automation rules', () => {
  it('flags a task only once it is the configured days overdue', () => {
    expect(isTaskOverdue({ dueDate: daysAgo(1), status: 'IN_PROGRESS' }, 2, now)).toBe(false);
    expect(isTaskOverdue({ dueDate: daysAgo(2), status: 'IN_PROGRESS' }, 2, now)).toBe(true);
  });

  it('never flags finished or undated tasks', () => {
    expect(isTaskOverdue({ dueDate: daysAgo(9), status: 'COMPLETED' }, 2, now)).toBe(false);
    expect(isTaskOverdue({ dueDate: null, status: 'ASSIGNED' }, 0, now)).toBe(false);
  });

  it('treats resolved tickets as not stale', () => {
    expect(isTicketStale({ createdAt: daysAgo(3), status: 'OPEN' }, 48, now)).toBe(true);
    expect(isTicketStale({ createdAt: daysAgo(3), status: 'RESOLVED' }, 48, now)).toBe(false);
  });

  it('computes budget use, including a zero budget', () => {
    expect(budgetPercent(8000, 10000)).toBe(80);
    expect(budgetPercent(1, 0)).toBe(100);
    expect(budgetPercent(0, 0)).toBe(0);
  });

  it('runs periodic jobs when never run or past the interval', () => {
    expect(isDue(null, 7, now)).toBe(true);
    expect(isDue(daysAgo(6), 7, now)).toBe(false);
    expect(isDue(daysAgo(7), 7, now)).toBe(true);
  });

  it('reminds only inside the window before a scheduled meeting', () => {
    const at = (min: number) => new Date(now.getTime() + min * 60_000);
    expect(needsReminder({ scheduledStart: at(10), status: 'SCHEDULED' }, 15, now)).toBe(true);
    expect(needsReminder({ scheduledStart: at(30), status: 'SCHEDULED' }, 15, now)).toBe(false);
    expect(needsReminder({ scheduledStart: at(-5), status: 'SCHEDULED' }, 15, now)).toBe(false);
    expect(needsReminder({ scheduledStart: at(10), status: 'LIVE' }, 15, now)).toBe(false);
  });

  it('writes CSV safely: quotes, commas and formula injection', () => {
    expect(toCsv([['Name', 'Note'], ['Rao, Sai', 'said "hi"'], ['=HYPERLINK()', -5]])).toBe(
      'Name,Note\r\n"Rao, Sai","said ""hi"""\r\n\'=HYPERLINK(),-5',
    );
  });

  it('validates config per trigger and explains the rule in words', () => {
    expect(parseConfig('TASK_OVERDUE', { days: '2' })).toEqual({ days: 2 });
    expect(() => parseConfig('BUDGET_THRESHOLD', { percent: 150 })).toThrow();
    expect(describeRule('EXPENSE_TWO_APPROVERS', { minAmount: 10000 })).toContain('₹10,000');
  });
});

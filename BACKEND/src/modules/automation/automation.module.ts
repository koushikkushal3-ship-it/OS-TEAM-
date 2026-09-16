import {
  Body,
  Controller,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GoogleDriveService } from '../integrations/google-drive.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { PermissionService } from '../permissions/permission.service.js';
import { BACKUPS_KEY, PlatformSettingsService } from '../platform/platform-settings.service.js';
import { BIN_RETENTION_DAYS, notify, teamLeadsOf, unpackSnapshot } from '../platform/records.js';
import { ReportsModule, ReportsService } from '../reports/reports.module.js';
import { type Trigger, budgetPercent, isDue, parseConfig, toCsv } from './rules.js';
import { ScheduleModule, ScheduleService } from '../schedule/schedule.module.js';

const DAY = 86_400_000;
const TICK_MS = 5 * 60_000;
const MEETING_REMINDER_MINUTES = 15;
const OPEN_TASKS = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;
/** Secrets and session data never leave the database in a backup. */
const BACKUP_EXCLUDED = new Set(['sessions', 'admin_mfa', 'system_settings', '_prisma_migrations']);

export interface BackupSettings {
  enabled: boolean;
  everyDays: number;
  lastAt: string | null;
  lastError: string | null;
  history: { at: string; name: string; url: string | null; tables: number; rows: number; bytes: number; by: string | null }[];
}
export const DEFAULT_BACKUPS: BackupSettings = { enabled: true, everyDays: 7, lastAt: null, lastError: null, history: [] };

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Every table except secrets, as one JSON file in the organization's Drive under "TEAM OS/Backups". */
  async run(byName: string | null) {
    if (!(await this.drive.status()).connected) {
      throw new ServiceUnavailableException('Connect Google Drive in Master → Integrations before running backups');
    }
    const schema = env.DATABASE_SCHEMA;
    const tables = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema} AND table_type = 'BASE TABLE' ORDER BY table_name`;

    const data: Record<string, unknown[]> = {};
    let rows = 0;
    for (const { table_name } of tables) {
      if (BACKUP_EXCLUDED.has(table_name) || !/^[a-z_][a-z0-9_]*$/.test(table_name)) continue;
      // Identifier comes from information_schema and is checked above, so quoting it is safe.
      const [result] = await this.prisma.$queryRawUnsafe<{ rows: unknown[] | null }[]>(`SELECT json_agg(t) AS rows FROM "${schema}"."${table_name}" t`);
      data[table_name] = result?.rows ?? [];
      rows += data[table_name].length;
    }

    const now = new Date();
    const content = JSON.stringify({ app: 'TEAM OS', createdAt: now.toISOString(), schema, tables: data });
    const name = `teamos-backup-${now.toISOString().slice(0, 10)}.json`;
    const current = await this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS);
    try {
      const file = await this.drive.uploadText(name, content, 'Backups', { mimeType: 'application/json' });
      const entry = { at: now.toISOString(), name, url: file.webViewLink ?? null, tables: Object.keys(data).length, rows, bytes: Buffer.byteLength(content), by: byName };
      await this.settings.set(BACKUPS_KEY, { ...current, lastAt: entry.at, lastError: null, history: [entry, ...current.history].slice(0, 20) });
      return entry;
    } catch (err) {
      await this.settings.set(BACKUPS_KEY, { ...current, lastError: `${stamp(now)}: ${(err as Error).message}` });
      throw err;
    }
  }
}

@Injectable()
export class WeeklyReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveService,
  ) {}

  /** Last 7 days per person — plain counts, so the sheet explains itself. */
  async csv(organizationId: string, now = new Date()) {
    const since = new Date(now.getTime() - 7 * DAY);
    const people = await this.prisma.user.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, department: { select: { name: true } }, teamMemberships: { select: { team: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    const rows: (string | number | null)[][] = [['Name', 'Email', 'Department', 'Teams', 'Completed (7 days)', 'Open tasks', 'Overdue', 'Work updates (7 days)', 'Meetings attended (7 days)', 'Meetings (7 days)', 'Kudos received (7 days)']];
    for (const p of people) {
      const [completed, open, overdue, updates, meetings, kudos] = await Promise.all([
        this.prisma.task.count({ where: { assignedToId: p.id, status: 'COMPLETED', completedAt: { gte: since } } }),
        this.prisma.task.count({ where: { assignedToId: p.id, status: { in: [...OPEN_TASKS] } } }),
        this.prisma.task.count({ where: { assignedToId: p.id, status: { in: [...OPEN_TASKS] }, dueDate: { lt: now } } }),
        this.prisma.taskUpdate.count({ where: { userId: p.id, createdAt: { gte: since } } }),
        this.prisma.meetingParticipant.findMany({ where: { userId: p.id, meeting: { status: 'ENDED', scheduledStart: { gte: since } } }, select: { status: true } }),
        this.prisma.kudos.count({ where: { toId: p.id, createdAt: { gte: since } } }),
      ]);
      const attended = meetings.filter((m) => ['PRESENT', 'LATE', 'PARTIAL', 'EXCUSED'].includes(m.status)).length;
      rows.push([p.name, p.email, p.department?.name ?? null, p.teamMemberships.map((t) => t.team.name).join('; '), completed, open, overdue, updates, attended, meetings.length, kudos]);
    }
    return toCsv(rows);
  }

  /** Saves as a Google Sheet when Drive is connected; returns null otherwise. */
  async saveSheet(name: string, csv: string) {
    if (!(await this.drive.status()).connected) return null;
    return this.drive.uploadText(name, csv, 'Reports', { mimeType: 'text/csv', asSheet: true });
  }
}

/** Runs rules on a timer. One process only — good enough for one organization's portal. */
@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly settings: PlatformSettingsService,
    private readonly backups: BackupService,
    private readonly weekly: WeeklyReportService,
    private readonly drive: GoogleDriveService,
    private readonly schedule: ScheduleService,
  ) {}

  onModuleInit() {
    if (env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 20_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.prisma.organization.findMany({ select: { id: true } });
      for (const org of orgs) {
        await this.safely('meeting reminders', () => this.meetingReminders(org.id, now));
        const rules = await this.prisma.automationRule.findMany({ where: { organizationId: org.id, enabled: true } });
        for (const rule of rules) await this.safely(rule.name, () => this.runRule(rule, now));
      }
      await this.safely('recycle bin purge', () => this.purgeBin(now));
      await this.safely('backups', () => this.scheduledBackup(now));
      await this.safely('google calendar', () => this.schedule.syncAll());
    } finally {
      this.running = false;
    }
  }

  /** After 30 days a deletion becomes permanent, including the Drive copy of a deleted file. */
  private async purgeBin(now: Date) {
    const expired = { deletedAt: { lt: new Date(now.getTime() - BIN_RETENTION_DAYS * DAY) }, restoredAt: null };
    const files = await this.prisma.deletedRecord.findMany({ where: { ...expired, entityType: 'file' }, select: { snapshot: true } });
    for (const f of files) {
      const driveFileId = unpackSnapshot(f.snapshot).row.driveFileId;
      if (typeof driveFileId === 'string') await this.drive.remove(driveFileId);
    }
    await this.prisma.deletedRecord.deleteMany({ where: { deletedAt: expired.deletedAt } });
  }

  private async safely(label: string, job: () => Promise<unknown>) {
    try {
      await job();
    } catch (err) {
      // Prisma messages start with a newline; flatten so the whole reason lands on one log line.
      this.logger.warn(`${label}: ${String((err as Error).message ?? err).replace(/\s+/g, ' ').trim().slice(0, 500)}`);
    }
  }

  /** True the first time only, so nobody is told about the same thing twice. */
  private async firstFiring(ruleId: string, entityId: string) {
    const { count } = await this.prisma.automationFiring.createMany({ data: [{ ruleId, entityId }], skipDuplicates: true });
    return count === 1;
  }

  private async meetingReminders(organizationId: string, now: Date) {
    const soon = await this.prisma.meeting.findMany({
      where: { organizationId, status: 'SCHEDULED', scheduledStart: { gt: now, lte: new Date(now.getTime() + MEETING_REMINDER_MINUTES * 60_000) } },
      select: { id: true, title: true, participants: { select: { userId: true } } },
    });
    for (const m of soon) {
      const link = `/meetings/${m.id}`;
      if (await this.prisma.notification.findFirst({ where: { type: 'meeting.reminder', link }, select: { id: true } })) continue;
      await notify(this.prisma, { organizationId, userIds: m.participants.map((p) => p.userId), type: 'meeting.reminder', title: `Starting soon: ${m.title}`, link });
    }
  }

  async runRule(rule: { id: string; organizationId: string; trigger: string; config: unknown; lastRunAt: Date | null }, now: Date) {
    const trigger = rule.trigger as Trigger;
    const orgId = rule.organizationId;

    if (trigger === 'TASK_OVERDUE') {
      const { days } = parseConfig(trigger, rule.config);
      const tasks = await this.prisma.task.findMany({
        where: { organizationId: orgId, status: { in: [...OPEN_TASKS] }, dueDate: { lte: new Date(now.getTime() - days * DAY) } },
        select: { id: true, title: true, assignedToId: true, teamId: true },
        take: 500,
      });
      for (const t of tasks) {
        if (!(await this.firstFiring(rule.id, t.id))) continue;
        const leads = t.teamId
          ? (await this.prisma.teamMember.findMany({ where: { teamId: t.teamId, memberRole: { in: ['LEAD', 'CO_LEAD'] } }, select: { userId: true } })).map((l) => l.userId)
          : t.assignedToId ? await teamLeadsOf(this.prisma, t.assignedToId) : [];
        await notify(this.prisma, { organizationId: orgId, userIds: [t.assignedToId, ...leads], type: 'automation.task_overdue', title: `Overdue: ${t.title}`, body: `More than ${days} day(s) past its due date.`, link: `/tasks/${t.id}` });
      }
    } else if (trigger === 'TICKET_STALE') {
      const { hours } = parseConfig(trigger, rule.config);
      const tickets = await this.prisma.ticket.findMany({
        where: { organizationId: orgId, status: { notIn: ['RESOLVED', 'CLOSED'] }, createdAt: { lte: new Date(now.getTime() - hours * 3_600_000) } },
        select: { id: true, number: true, title: true, assigneeId: true, requesterId: true },
        take: 500,
      });
      for (const t of tickets) {
        if (!(await this.firstFiring(rule.id, t.id))) continue;
        const who = t.assigneeId ? [t.assigneeId] : t.requesterId ? await teamLeadsOf(this.prisma, t.requesterId) : [];
        await notify(this.prisma, { organizationId: orgId, userIds: who, type: 'automation.ticket_stale', title: `Ticket #${t.number} still open: ${t.title}`, body: `Open for more than ${hours} hour(s).`, link: '/tickets' });
      }
    } else if (trigger === 'BUDGET_THRESHOLD') {
      const { percent } = parseConfig(trigger, rule.config);
      const budgets = await this.prisma.budget.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, amount: true, createdById: true, eventId: true, event: { select: { ownerId: true, name: true } } } });
      const spent = await this.prisma.expense.groupBy({ by: ['budgetId'], where: { budgetId: { in: budgets.map((b) => b.id) }, status: { in: ['APPROVED', 'REIMBURSED'] } }, _sum: { amount: true } });
      for (const b of budgets) {
        const used = Number(spent.find((s) => s.budgetId === b.id)?._sum.amount ?? 0);
        const pct = budgetPercent(used, Number(b.amount));
        if (pct < percent || !(await this.firstFiring(rule.id, `${b.id}:${percent}`))) continue;
        await notify(this.prisma, { organizationId: orgId, userIds: [b.event?.ownerId, b.createdById], type: 'automation.budget', title: `Budget ${pct}% used: ${b.name}${b.event ? ` (${b.event.name})` : ''}`, body: `₹${used.toLocaleString('en-IN')} of ₹${Number(b.amount).toLocaleString('en-IN')} approved so far.`, link: '/finance' });
      }
    } else if (trigger === 'WEEKLY_REPORT') {
      if (!isDue(rule.lastRunAt, 7, now)) return;
      const csv = await this.weekly.csv(orgId, now);
      const sheet = await this.weekly.saveSheet(`TEAM OS weekly report ${now.toISOString().slice(0, 10)}`, csv);
      await notify(this.prisma, {
        organizationId: orgId,
        userIds: await this.permissions.usersWith(orgId, 'report.view'),
        type: 'automation.weekly_report',
        title: 'Weekly report is ready',
        body: sheet ? 'Saved to Google Sheets in the organization Drive (TEAM OS/Reports).' : 'Connect Google Drive to also receive it as a Google Sheet.',
        link: sheet?.webViewLink ?? '/reports',
      });
    }
    // EXPENSE_TWO_APPROVERS is enforced inside Finance at approval time, not on the timer.

    await this.prisma.automationRule.update({ where: { id: rule.id }, data: { lastRunAt: now } });
  }

  private async scheduledBackup(now: Date) {
    const cfg = await this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS);
    if (!cfg.enabled || !isDue(cfg.lastAt ? new Date(cfg.lastAt) : null, cfg.everyDays, now)) return;
    await this.backups.run('Scheduled');
  }
}

const exportBody = z.object({ kind: z.enum(['people', 'weekly']) });

@Controller('reports')
export class ReportExportController {
  constructor(
    private readonly reports: ReportsService,
    private readonly weekly: WeeklyReportService,
    private readonly audit: AuditService,
  ) {}

  /** Saves a report into the organization's Drive as a real Google Sheet. */
  @Post('export-sheet')
  @RequirePermission('report.export')
  async exportSheet(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(exportBody)) body: z.infer<typeof exportBody>) {
    const today = new Date().toISOString().slice(0, 10);
    let csv: string;
    if (body.kind === 'weekly') {
      csv = await this.weekly.csv(req.user.organizationId);
    } else {
      const rows = await this.reports.people(req.auth, {});
      csv = toCsv([
        ['Name', 'Score', 'Completion %', 'Deadlines %', 'Updates %', 'Attendance %', 'Tasks', 'Completed', 'Active', 'Meetings', 'Attended'],
        ...rows.map((r) => [r.person.name, r.score, r.breakdown.completion, r.breakdown.deadlines, r.breakdown.updates, r.breakdown.attendance, r.work.tasksTotal, r.work.tasksCompleted, r.work.tasksActive, r.work.meetingsTotal, r.work.meetingsAttended]),
      ]);
    }
    const name = `TEAM OS ${body.kind === 'weekly' ? 'weekly report' : 'people performance'} ${today}`;
    const sheet = await this.weekly.saveSheet(name, csv);
    if (!sheet) throw new ServiceUnavailableException('Connect Google Drive in Master → Integrations to export to Google Sheets');
    await this.audit.record(actorFrom(req), { action: 'report.exported_sheet', entityType: 'report', entityId: sheet.id, newValue: { kind: body.kind, name } });
    return { name, url: sheet.webViewLink ?? `https://docs.google.com/spreadsheets/d/${sheet.id}` };
  }
}

@Module({
  imports: [IntegrationsModule, ReportsModule, ScheduleModule],
  controllers: [ReportExportController],
  providers: [AutomationService, BackupService, WeeklyReportService],
  exports: [AutomationService, BackupService],
})
export class AutomationModule {}

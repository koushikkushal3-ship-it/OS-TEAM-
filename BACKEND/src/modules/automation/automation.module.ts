import {
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { BACKUPS_KEY, PlatformSettingsService } from '../platform/platform-settings.service.js';
import { BIN_RETENTION_DAYS, notify, teamLeadsOf, unpackSnapshot } from '../platform/records.js';
import { ReportsModule, ReportsService } from '../reports/reports.module.js';
import { type Trigger, budgetPercent, isDue, parseConfig, toCsv } from './rules.js';
import { type Cell, buildXlsx, exportFileName } from './spreadsheet.js';
import { ScheduleModule, ScheduleService } from '../schedule/schedule.module.js';
import { FileStorageService, type StorageProvider } from '../platform/file-storage.service.js';

const DAY = 86_400_000;
const TICK_MS = 5 * 60_000;
const MEETING_REMINDER_MINUTES = 15;
const OPEN_TASKS = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;
/** Secrets and session data never leave the database in a backup. */
const BACKUP_EXCLUDED = new Set(['sessions', 'admin_mfa', 'system_settings', '_prisma_migrations', 'file_blobs']);

export interface BackupSettings {
  enabled: boolean;
  everyDays: number;
  lastAt: string | null;
  lastError: string | null;
  history: { at: string; name: string; url: string | null; key?: string; provider?: StorageProvider; tables: number; rows: number; bytes: number; by: string | null }[];
}
export const DEFAULT_BACKUPS: BackupSettings = { enabled: true, everyDays: 7, lastAt: null, lastError: null, history: [] };

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Every table except secrets and stored file bytes, saved as one JSON file in TEAM OS storage. */
  async run(byName: string | null) {
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
    const name = `teamos-backup-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    const current = await this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS);
    try {
      const stored = await this.storage.put(`backups/${name}`, Buffer.from(content), 'application/json');
      const entry = { at: now.toISOString(), name, url: null, key: stored.key, provider: stored.provider, tables: Object.keys(data).length, rows, bytes: Buffer.byteLength(content), by: byName };
      const history = [entry, ...current.history];
      // Keep the 10 newest backup files; older ones are removed from storage.
      for (const old of history.slice(10)) if (old.key && old.provider) await this.storage.remove(old.provider, old.key);
      await this.settings.set(BACKUPS_KEY, { ...current, lastAt: entry.at, lastError: null, history: history.slice(0, 10) });
      return entry;
    } catch (err) {
      await this.settings.set(BACKUPS_KEY, { ...current, lastError: `${stamp(now)}: ${(err as Error).message}` });
      throw err;
    }
  }

  /** Bytes of a backup listed in the history — nothing else can be fetched this way. */
  async download(key: string) {
    const current = await this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS);
    const entry = current.history.find((h) => h.key === key);
    if (!entry?.key || !entry.provider) throw new NotFoundException('That backup is not available');
    return { name: entry.name, buffer: await this.storage.get(entry.provider, entry.key) };
  }
}

@Injectable()
export class WeeklyReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Last 7 days per person — plain counts, so the sheet explains itself. */
  async rows(organizationId: string, now = new Date()): Promise<Cell[][]> {
    const since = new Date(now.getTime() - 7 * DAY);
    const people = await this.prisma.user.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, department: { select: { name: true } }, teamMemberships: { select: { team: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    const rows: Cell[][] = [['Name', 'Email', 'Department', 'Teams', 'Completed (7 days)', 'Open tasks', 'Overdue', 'Work updates (7 days)', 'Meetings attended (7 days)', 'Meetings (7 days)', 'Kudos received (7 days)']];
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
    return rows;
  }

  /** Keeps a copy in the portal so it can be downloaded later as Excel or CSV. */
  save(organizationId: string, kind: string, title: string, rows: Cell[][], createdById?: string) {
    return this.prisma.reportSnapshot.create({ data: { organizationId, kind, title, rows: rows as object, createdById } });
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
    private readonly storage: FileStorageService,
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
      const row = unpackSnapshot(f.snapshot).row;
      await this.storage.remove(row.storageProvider as StorageProvider, (row.storageKey as string | null) ?? null);
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
      const snapshot = await this.weekly.save(orgId, 'weekly', `Weekly report ${now.toISOString().slice(0, 10)}`, await this.weekly.rows(orgId, now));
      await notify(this.prisma, {
        organizationId: orgId,
        userIds: await this.permissions.usersWith(orgId, 'report.view'),
        type: 'automation.weekly_report',
        title: 'Weekly report is ready',
        body: 'Open Reports → Saved reports to download it as Excel or CSV.',
        link: `/reports?saved=${snapshot.id}`,
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

const exportQuery = z.object({ kind: z.enum(['people', 'weekly']), format: z.enum(['xlsx', 'csv']).default('xlsx') });
const formatQuery = z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') });

@Controller('reports')
export class ReportExportController {
  constructor(
    private readonly reports: ReportsService,
    private readonly weekly: WeeklyReportService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  private async build(req: AuthenticatedRequest, kind: 'people' | 'weekly'): Promise<{ title: string; rows: Cell[][] }> {
    const today = new Date().toISOString().slice(0, 10);
    if (kind === 'weekly') return { title: `Weekly report ${today}`, rows: await this.weekly.rows(req.user.organizationId) };
    const people = await this.reports.people(req.auth, {});
    return {
      title: `People performance ${today}`,
      rows: [
        ['Name', 'Score', 'Completion %', 'Deadlines %', 'Updates %', 'Attendance %', 'Tasks', 'Completed', 'Active', 'Meetings', 'Attended'],
        ...people.map((r) => [r.person.name, r.score, r.breakdown.completion, r.breakdown.deadlines, r.breakdown.updates, r.breakdown.attendance, r.work.tasksTotal, r.work.tasksCompleted, r.work.tasksActive, r.work.meetingsTotal, r.work.meetingsAttended]),
      ],
    };
  }

  private async send(res: Response, title: string, rows: Cell[][], format: 'xlsx' | 'csv') {
    const name = exportFileName(title, format);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      // The byte-order mark makes Excel read Indian names and ₹ correctly.
      return res.send(`\uFEFF${toCsv(rows)}`);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(await buildXlsx(title, rows));
  }

  /** Downloads a fresh report as an Excel workbook or CSV file. */
  @Get('export')
  @RequirePermission('report.export')
  async export(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>, @Res() res: Response) {
    const { title, rows } = await this.build(req, q.kind);
    await this.audit.record(actorFrom(req), { action: 'report.exported', entityType: 'report', entityId: q.kind, newValue: { format: q.format, rows: rows.length - 1 } });
    return this.send(res, title, rows, q.format);
  }

  @Get('saved')
  @RequirePermission('report.view')
  async saved(@Req() req: AuthenticatedRequest) {
    const items = await this.prisma.reportSnapshot.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { id: true, kind: true, title: true, rows: true, createdAt: true },
    });
    return items.map(({ rows, ...i }) => ({ ...i, people: Math.max((rows as unknown[]).length - 1, 0) }));
  }

  /** Saves a copy of the report now, next to the automatic weekly ones. */
  @Post('saved')
  @RequirePermission('report.export')
  async saveNow(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(z.object({ kind: z.enum(['people', 'weekly']) }))) body: { kind: 'people' | 'weekly' }) {
    const { title, rows } = await this.build(req, body.kind);
    const snapshot = await this.weekly.save(req.user.organizationId, body.kind, title, rows, req.user.id);
    await this.audit.record(actorFrom(req), { action: 'report.saved', entityType: 'report', entityId: snapshot.id, newValue: { kind: body.kind, title } });
    return { id: snapshot.id, title: snapshot.title, createdAt: snapshot.createdAt };
  }

  @Get('saved/:id/download')
  @RequirePermission('report.view')
  async downloadSaved(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(formatQuery)) q: z.infer<typeof formatQuery>, @Res() res: Response) {
    const snapshot = await this.prisma.reportSnapshot.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    return this.send(res, snapshot.title, snapshot.rows as Cell[][], q.format);
  }
}

@Module({
  imports: [ReportsModule, ScheduleModule],
  controllers: [ReportExportController],
  providers: [AutomationService, BackupService, WeeklyReportService],
  exports: [AutomationService, BackupService],
})
export class AutomationModule {}

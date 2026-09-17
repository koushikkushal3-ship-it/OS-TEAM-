import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { MasterOnly, Public } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService, VIEW_AS_COOKIE, VIEW_AS_MINUTES } from '../auth/session.service.js';
import { AutomationModule, AutomationService, BackupService, type BackupSettings, DEFAULT_BACKUPS } from '../automation/automation.module.js';
import { TRIGGER_KEYS, TRIGGERS, type Trigger, describeRule, parseConfig } from '../automation/rules.js';
import { CustomModulesModule, CustomModulesService } from '../custom/custom.module.js';
import { GoogleDriveService } from '../integrations/google-drive.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { PRESETS, applyAccessPreset, detectPreset } from '../permissions/access-presets.js';
import { PermissionService } from '../permissions/permission.service.js';
import {
  BACKUPS_KEY,
  BRANDING_KEY,
  type BrandingSetting,
  MAINTENANCE_KEY,
  type MaintenanceSetting,
  PlatformSettingsService,
} from '../platform/platform-settings.service.js';
import { BIN_MODELS, BIN_RETENTION_DAYS, type BinEntity, masterAdmins, notify, unpackSnapshot } from '../platform/records.js';
import { detectAlerts, deviceOf } from './alerts.js';
import { parseInvites } from './csv.js';
import { DATABASE_FILE_LIMIT, FileStorageService, type StorageProvider } from '../platform/file-storage.service.js';
import argon2 from 'argon2';
import { generatePassword, passwordProblem } from '../auth/password.js';

const DAY = 86_400_000;
const OPEN_TASKS = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;
const LOGIN_ACTIONS = ['auth.login', 'auth.first_login', 'master.gateway.code_failed', 'master.gateway.mfa_failed', 'master.session.started', 'master.view_as.started'];
const ALERT_ACTIONS = [...LOGIN_ACTIONS, 'file.downloaded', 'user.master_admin_granted'];

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

const announcementBody = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(2).max(2000),
  scopeType: z.enum(['ORGANIZATION', 'DEPARTMENT', 'TEAM', 'EVENT']).default('ORGANIZATION'),
  scopeId: z.string().uuid().nullish(),
  tone: z.enum(['info', 'warning', 'success']).default('info'),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullish(),
});

const ruleBody = z.object({
  name: z.string().trim().min(2).max(120),
  trigger: z.enum(TRIGGER_KEYS as [Trigger, ...Trigger[]]),
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

const addPersonBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
  departmentId: z.string().uuid().nullish(),
  roleId: z.string().uuid().nullish(),
  mustChangePassword: z.boolean().default(true),
});

const setPasswordBody = z.object({ password: z.string().min(1).max(128), mustChangePassword: z.boolean().default(true) });

const brandingBody = z.object({
  logoUrl: z.string().trim().url().startsWith('https://').max(500).nullish(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  loginMessage: z.string().trim().max(300).nullish(),
});

/**
 * Master Admin control centre: preview as a person, access map, sign-in history and alerts,
 * system health, sessions, maintenance, offboarding, bulk invites, recycle bin, backups,
 * two-person approvals, undo, branding, announcements and automation rules.
 */
@MasterOnly()
@Controller('master/control')
export class ControlController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
    private readonly sessions: SessionService,
    private readonly settings: PlatformSettingsService,
    private readonly drive: GoogleDriveService,
    private readonly backups: BackupService,
    private readonly automation: AutomationService,
    private readonly custom: CustomModulesService,
    private readonly storage: FileStorageService,
  ) {}

  private person(req: AuthenticatedRequest, id: string) {
    return this.prisma.user.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
  }

  // ── View as ────────────────────────────────────────────────────

  @Post('view-as/:userId')
  async viewAs(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) userId: string, @Res({ passthrough: true }) res: Response) {
    const target = await this.person(req, userId);
    if (target.id === req.user.id) throw new BadRequestException('You are already seeing the portal as yourself');
    if (target.status === 'DISABLED') throw new BadRequestException('A disabled person cannot be previewed');
    const token = await this.sessions.createViewAs(target.id, req.user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(VIEW_AS_COOKIE, token, { ...this.sessions.cookieOptions(), maxAge: VIEW_AS_MINUTES * 60_000 });
    await this.audit.record(actorFrom(req), { action: 'master.view_as.started', entityType: 'user', entityId: target.id, newValue: { viewing: target.email, minutes: VIEW_AS_MINUTES } });
    return { viewing: { id: target.id, name: target.name }, minutes: VIEW_AS_MINUTES };
  }

  // ── Access map ─────────────────────────────────────────────────

  @Get('access-map')
  async accessMap(@Req() req: AuthenticatedRequest) {
    const orgId = req.user.organizationId;
    const [modules, people, overrides] = await Promise.all([
      this.prisma.module.findMany({ where: { status: 'ENABLED', key: { not: 'administration' } }, orderBy: [{ phase: 'asc' }, { name: 'asc' }], include: { permissions: { select: { key: true } } } }),
      this.prisma.user.findMany({ where: { organizationId: orgId, status: { not: 'DISABLED' } }, select: { id: true, name: true, email: true, status: true, department: { select: { name: true } } }, orderBy: { name: 'asc' } }),
      this.prisma.permissionOverride.findMany({ where: { organizationId: orgId, scopeType: 'USER', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    ]);

    const rows = [];
    for (const p of people) {
      const ctx = await this.permissions.buildContext(p.id, { id: 'map', privilegedUntil: null });
      const visible = new Set(await this.permissions.visibleModules(ctx));
      const cells: Record<string, { visible: boolean; personal: string; expiresAt: Date | null }> = {};
      for (const m of modules) {
        const keys = m.permissions.map((x) => x.key);
        const prefix = keys[0]?.split('.')[0];
        const mine = overrides.filter((o) => o.scopeId === p.id && (keys.includes(o.permissionKey) || o.permissionKey === `${prefix}.*`));
        cells[m.key] = { visible: visible.has(m.key), personal: detectPreset(mine, prefix, keys.find((k) => k.endsWith('.view'))), expiresAt: mine.find((o) => o.expiresAt)?.expiresAt ?? null };
      }
      rows.push({ person: p, cells });
    }
    return { modules: modules.map((m) => ({ key: m.key, name: m.name, isCore: m.isCore })), rows };
  }

  // ── Sign-in history & security alerts ──────────────────────────

  @Get('logins')
  async logins(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ userId: z.string().uuid().optional(), days: z.coerce.number().int().min(1).max(365).default(30) }))) q: { userId?: string; days: number }) {
    const since = new Date(Date.now() - q.days * DAY);
    const entries = await this.prisma.auditLog.findMany({
      where: { organizationId: req.user.organizationId, action: { in: LOGIN_ACTIONS }, createdAt: { gte: since }, ...(q.userId && { actorId: q.userId }) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    const sessions = await this.prisma.session.findMany({
      where: { user: { organizationId: req.user.organizationId }, revokedAt: null, expiresAt: { gt: new Date() }, ...(q.userId && { userId: q.userId }) },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, impersonatorId: true, privilegedUntil: true, user: { select: { id: true, name: true } } },
    });
    return {
      entries: entries.map((e) => ({ id: e.id, action: e.action, at: e.createdAt, ip: e.ip, device: deviceOf(e.userAgent), actor: e.actor })),
      sessions: sessions.map(({ userAgent, ...s }) => ({ ...s, device: deviceOf(userAgent), current: s.id === req.session.id })),
    };
  }

  @Get('alerts')
  async alerts(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }))) q: { days: number }) {
    const orgId = req.user.organizationId;
    const since = new Date(Date.now() - q.days * DAY);
    const select = { id: true, action: true, actorId: true, ip: true, userAgent: true, createdAt: true, actor: { select: { name: true } } } as const;
    const [recent, history] = await Promise.all([
      this.prisma.auditLog.findMany({ where: { organizationId: orgId, action: { in: ALERT_ACTIONS }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 5000, select }),
      this.prisma.auditLog.findMany({ where: { organizationId: orgId, action: { in: ['auth.login', 'auth.first_login'] }, createdAt: { lt: since, gte: new Date(since.getTime() - 90 * DAY) } }, take: 5000, select }),
    ]);
    const flat = (rows: typeof recent) => rows.map(({ actor, ...r }) => ({ ...r, actorName: actor?.name ?? null }));
    return detectAlerts(flat(recent), flat(history));
  }

  // ── System health ──────────────────────────────────────────────

  @Get('health')
  async health(@Req() req: AuthenticatedRequest) {
    const orgId = req.user.organizationId;
    const schema = env.DATABASE_SCHEMA;
    const [size, tables, people, drive, quota, backups, pendingApprovals, binItems, rules, maintenance] = await Promise.all([
      this.prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`,
      this.prisma.$queryRaw<{ name: string; rows: bigint; bytes: bigint }[]>`
        SELECT relname AS name, n_live_tup::bigint AS rows, pg_total_relation_size(relid)::bigint AS bytes
        FROM pg_stat_user_tables WHERE schemaname = ${schema} ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`,
      this.prisma.user.groupBy({ by: ['status'], where: { organizationId: orgId }, _count: true }),
      this.drive.status(),
      this.drive.quota(),
      this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS),
      this.prisma.changeRequest.count({ where: { organizationId: orgId, status: 'PENDING' } }),
      this.prisma.deletedRecord.count({ where: { organizationId: orgId, restoredAt: null } }),
      this.prisma.automationRule.findMany({ where: { organizationId: orgId }, select: { enabled: true, lastRunAt: true } }),
      this.settings.maintenance(),
    ]);
    const count = (s: string) => people.find((p) => p.status === s)?._count ?? 0;
    const signInCapable = count('ACTIVE') + count('INVITED');
    return {
      database: {
        bytes: num(size[0]?.bytes),
        // Supabase free plan database limit.
        limitBytes: 500 * 1024 * 1024,
        tables: tables.map((t) => ({ name: t.name, rows: num(t.rows), bytes: num(t.bytes) })),
      },
      people: { active: count('ACTIVE'), invited: count('INVITED'), disabled: count('DISABLED'), googleTestUserCap: 100, signInCapable },
      drive: { connected: drive.connected, email: drive.connectedEmail, usageBytes: quota?.usage ?? null, limitBytes: quota?.limit ?? null },
      backups: { enabled: backups.enabled, everyDays: backups.everyDays, lastAt: backups.lastAt, lastError: backups.lastError },
      automation: { rules: rules.length, enabled: rules.filter((r) => r.enabled).length, lastRunAt: rules.map((r) => r.lastRunAt).filter(Boolean).sort().at(-1) ?? null },
      storage: { provider: this.storage.provider, fileLimitMb: this.storage.provider === 'database' ? DATABASE_FILE_LIMIT / 1024 / 1024 : null },
      pendingApprovals,
      recycleBin: binItems,
      maintenance,
    };
  }

  // ── Sessions, offboarding, bulk invite ─────────────────────────

  @Post('people/:id/sign-out')
  async signOutEverywhere(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const person = await this.person(req, id);
    // Never cut off the session making this request.
    const { count } = await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null, id: { not: req.session.id } }, data: { revokedAt: new Date() } });
    await this.audit.record(actorFrom(req), { action: 'user.signed_out_everywhere', entityType: 'user', entityId: id, newValue: { user: person.email, sessions: count } });
    return { sessions: count };
  }

  @Post('people/:id/offboard')
  async offboard(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ reassignToId: z.string().uuid().nullish() }))) body: { reassignToId?: string | null }) {
    const orgId = req.user.organizationId;
    const person = await this.person(req, id);
    if (id === req.user.id) throw new BadRequestException('You cannot offboard yourself');
    if (body.reassignToId === id) throw new BadRequestException('Choose someone else to take over the work');
    const heir = body.reassignToId ? await this.prisma.user.findFirstOrThrow({ where: { id: body.reassignToId, organizationId: orgId, status: 'ACTIVE' } }) : null;
    const masters = await masterAdmins(this.prisma, orgId);
    if (masters.includes(id) && masters.length <= 1) throw new BadRequestException('This is the last active Master Admin');

    const to = heir?.id ?? null;
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const tasks = await tx.task.updateMany({ where: { assignedToId: id, status: { in: [...OPEN_TASKS] } }, data: to ? { assignedToId: to } : { assignedToId: null, status: 'BACKLOG' } });
      const tickets = await tx.ticket.updateMany({ where: { assigneeId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } }, data: to ? { assigneeId: to } : { assigneeId: null, status: 'OPEN' } });
      const events = await tx.event.updateMany({ where: { ownerId: id, status: { in: ['PLANNING', 'ACTIVE'] } }, data: { ownerId: to } });
      const opportunities = await tx.opportunity.updateMany({ where: { ownerId: id }, data: { ownerId: to } });
      const records = await tx.customRecord.updateMany({ where: { ownerId: id }, data: { ownerId: to } });
      const runItems = await tx.runItem.updateMany({ where: { ownerId: id, doneAt: null }, data: { ownerId: to } });
      const shifts = await tx.shiftAssignment.deleteMany({ where: { userId: id, shift: { startsAt: { gt: now } } } });
      const leave = await tx.leaveRequest.updateMany({ where: { userId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      const teams = await tx.teamMember.deleteMany({ where: { userId: id } });
      const sessions = await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.user.update({ where: { id }, data: { status: 'DISABLED' } });
      return { tasks: tasks.count, tickets: tickets.count, events: events.count, opportunities: opportunities.count, records: records.count, runItems: runItems.count, futureShifts: shifts.count, pendingLeave: leave.count, teams: teams.count, sessions: sessions.count };
    });
    this.permissions.invalidate(orgId);
    await this.audit.record(actorFrom(req), { action: 'user.offboarded', entityType: 'user', entityId: id, oldValue: { status: person.status }, newValue: { status: 'DISABLED', reassignedTo: heir?.email ?? null, ...result } });
    if (heir && result.tasks + result.tickets + result.events + result.opportunities + result.records + result.runItems > 0) {
      await notify(this.prisma, { organizationId: orgId, userIds: [heir.id], exceptUserId: req.user.id, type: 'user.handover', title: `You took over ${person.name}'s open work`, body: `${result.tasks} task(s), ${result.tickets} ticket(s), ${result.events} event(s) and more.`, link: '/work' });
    }
    return { ...result, reassignedTo: heir ? { id: heir.id, name: heir.name } : null };
  }

  @Post('people/bulk-invite')
  async bulkInvite(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(z.object({ csv: z.string().max(200_000), dryRun: z.boolean().default(false) }))) body: { csv: string; dryRun: boolean }) {
    const orgId = req.user.organizationId;
    const { rows, errors } = parseInvites(body.csv);
    const [departments, roles, existing] = await Promise.all([
      this.prisma.department.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
      this.prisma.role.findMany({ where: { organizationId: orgId, isActive: true, isMasterAdmin: false }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { email: { in: rows.map((r) => r.email) } }, select: { email: true } }),
    ]);
    const byName = <T extends { name: string }>(list: T[], name: string | null) => (name ? list.find((x) => x.name.toLowerCase() === name.toLowerCase()) : undefined);
    const taken = new Set(existing.map((e) => e.email));

    const ready: { line: number; email: string; name: string; departmentId: string | null; roleId: string | null; password: string | null }[] = [];
    const problems = [...errors];
    for (const r of rows) {
      if (taken.has(r.email)) {
        problems.push({ line: r.line, message: `${r.email} already has an account` });
        continue;
      }
      const dept = byName(departments, r.department);
      const role = byName(roles, r.role);
      if (r.department && !dept) problems.push({ line: r.line, message: `Unknown department "${r.department}" — invited without one` });
      if (r.role && !role) problems.push({ line: r.line, message: `Unknown role "${r.role}" (Master Admin cannot be bulk-assigned) — invited without one` });
      const weak = r.password ? passwordProblem(r.password, r.email) : null;
      if (weak) {
        problems.push({ line: r.line, message: `Password for ${r.email}: ${weak}` });
        continue;
      }
      ready.push({ line: r.line, email: r.email, name: r.name, departmentId: dept?.id ?? null, roleId: role?.id ?? null, password: r.password });
    }
    if (body.dryRun) return { dryRun: true, ready: ready.length, problems };

    // Generated passwords are shown to the Master Admin once, here, so they can be handed out.
    const credentials: { name: string; email: string; password: string }[] = [];
    for (const r of ready) {
      const password = r.password ?? generatePassword();
      credentials.push({ name: r.name, email: r.email, password });
      const user = await this.prisma.user.create({
        data: { organizationId: orgId, email: r.email, name: r.name, departmentId: r.departmentId, status: 'INVITED', passwordHash: await argon2.hash(password), mustChangePassword: true },
      });
      if (r.roleId) await this.prisma.userRole.create({ data: { userId: user.id, roleId: r.roleId, scopeType: 'ORGANIZATION', assignedById: req.user.id } });
      await this.audit.record(actorFrom(req), { action: 'user.invited', entityType: 'user', entityId: user.id, newValue: { email: r.email, name: r.name, source: 'bulk', roleId: r.roleId } });
    }
    return { dryRun: false, created: ready.length, problems, credentials };
  }

  /** Creates a person with their sign-in password in one step. Only Master Admin can add people this way. */
  @Post('people')
  async addPerson(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(addPersonBody)) body: z.infer<typeof addPersonBody>) {
    const orgId = req.user.organizationId;
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new BadRequestException(problem);
    if (await this.prisma.user.findUnique({ where: { email: body.email } })) throw new ConflictException('Someone with this email already exists');
    if (body.departmentId) await this.prisma.department.findFirstOrThrow({ where: { id: body.departmentId, organizationId: orgId } });
    const role = body.roleId ? await this.prisma.role.findFirstOrThrow({ where: { id: body.roleId, organizationId: orgId, isActive: true } }) : null;
    if (role?.isMasterAdmin) throw new BadRequestException('Give Master Admin from the Roles button, where the two-person rule applies');

    const user = await this.prisma.user.create({
      data: {
        organizationId: orgId,
        email: body.email,
        name: body.name,
        departmentId: body.departmentId ?? null,
        status: 'INVITED',
        passwordHash: await argon2.hash(body.password),
        mustChangePassword: body.mustChangePassword,
      },
    });
    if (role) await this.prisma.userRole.create({ data: { userId: user.id, roleId: role.id, scopeType: 'ORGANIZATION', assignedById: req.user.id } });
    await this.audit.record(actorFrom(req), { action: 'user.invited', entityType: 'user', entityId: user.id, newValue: { email: body.email, name: body.name, role: role?.name ?? null, source: 'master_with_password' } });
    return { id: user.id, email: user.email, name: user.name };
  }

  /** Sets a new password for someone (forgotten password, first setup). Signs them out everywhere. */
  @Post('people/:id/password')
  async setPassword(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(setPasswordBody)) body: z.infer<typeof setPasswordBody>) {
    const person = await this.person(req, id);
    const problem = passwordProblem(body.password, person.email);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(body.password), passwordChangedAt: new Date(), mustChangePassword: body.mustChangePassword } });
    // Never cut off the Master Admin's own current session.
    await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null, id: { not: req.session.id } }, data: { revokedAt: new Date() } });
    await this.audit.record(actorFrom(req), { action: 'user.password_set', entityType: 'user', entityId: id, newValue: { user: person.email, mustChangePassword: body.mustChangePassword } });
    return { ok: true };
  }

  @Get('passwords/generate')
  generate() {
    return { password: generatePassword() };
  }

  // ── Maintenance & branding ─────────────────────────────────────

  @Get('maintenance')
  maintenance() {
    return this.settings.maintenance();
  }

  /** Every maintenance change is saved whole, so "undo" in the audit log can put the previous state back. */
  private async saveMaintenance(req: AuthenticatedRequest, next: MaintenanceSetting) {
    const before = await this.settings.maintenance();
    const saved = await this.settings.set(MAINTENANCE_KEY, next, req.user.id);
    await this.audit.record(actorFrom(req), { action: 'platform.maintenance_changed', entityType: 'system_setting', entityId: MAINTENANCE_KEY, oldValue: before, newValue: saved });
    return saved;
  }

  @Put('maintenance')
  async setMaintenance(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(z.object({ enabled: z.boolean(), message: z.string().trim().max(300).default('') }))) body: { enabled: boolean; message: string }) {
    const current = await this.settings.maintenance();
    return this.saveMaintenance(req, { ...current, ...body });
  }

  /** Closes one person's portal; everyone else keeps working. */
  @Post('maintenance/people')
  async addMaintenancePerson(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(z.object({ userId: z.string().uuid(), message: z.string().trim().max(300).default('') }))) body: { userId: string; message: string }) {
    if (body.userId === req.user.id) throw new BadRequestException('You cannot put your own portal in maintenance');
    const person = await this.person(req, body.userId);
    const current = await this.settings.maintenance();
    const people = [...(current.people ?? []).filter((p) => p.userId !== person.id), { userId: person.id, name: person.name, message: body.message, since: new Date().toISOString() }];
    return this.saveMaintenance(req, { ...current, people });
  }

  @Delete('maintenance/people/:userId')
  async removeMaintenancePerson(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    const current = await this.settings.maintenance();
    return this.saveMaintenance(req, { ...current, people: (current.people ?? []).filter((p) => p.userId !== userId) });
  }

  @Get('branding')
  branding() {
    return this.settings.branding();
  }

  @Put('branding')
  async setBranding(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(brandingBody)) body: z.infer<typeof brandingBody>) {
    const before = await this.settings.branding();
    const saved = await this.settings.set<BrandingSetting>(BRANDING_KEY, { logoUrl: body.logoUrl ?? null, brandColor: body.brandColor ?? null, loginMessage: body.loginMessage ?? null }, req.user.id);
    await this.audit.record(actorFrom(req), { action: 'platform.branding_changed', entityType: 'system_setting', entityId: BRANDING_KEY, oldValue: before, newValue: saved });
    return saved;
  }

  // ── Recycle bin ────────────────────────────────────────────────

  private binWhere(req: AuthenticatedRequest) {
    return { organizationId: req.user.organizationId, restoredAt: null, deletedAt: { gte: new Date(Date.now() - BIN_RETENTION_DAYS * DAY) } };
  }

  /** "review" = deletions nobody has looked at yet; "ignored" = accepted, still restorable until purged. */
  @Get('bin')
  async bin(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ view: z.enum(['review', 'ignored']).default('review') }))) q: { view: 'review' | 'ignored' }) {
    const where = this.binWhere(req);
    const [items, review, ignored] = await Promise.all([
      this.prisma.deletedRecord.findMany({
        where: { ...where, reviewedAt: q.view === 'review' ? null : { not: null } },
        orderBy: { deletedAt: 'desc' },
        take: 300,
        select: { id: true, entityType: true, entityId: true, label: true, deletedAt: true, deletedById: true, reviewedAt: true, reviewedById: true },
      }),
      this.prisma.deletedRecord.count({ where: { ...where, reviewedAt: null } }),
      this.prisma.deletedRecord.count({ where: { ...where, reviewedAt: { not: null } } }),
    ]);
    const ids = [...new Set(items.flatMap((i) => [i.deletedById, i.reviewedById]).filter((x): x is string => !!x))];
    const names = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
    const who = (id: string | null) => names.find((n) => n.id === id) ?? null;
    return {
      counts: { review, ignored },
      items: items.map((i) => ({ ...i, deletedBy: who(i.deletedById), reviewedBy: who(i.reviewedById), purgeAt: new Date(i.deletedAt.getTime() + BIN_RETENTION_DAYS * DAY) })),
    };
  }

  @Get('bin/count')
  async binCount(@Req() req: AuthenticatedRequest) {
    return { review: await this.prisma.deletedRecord.count({ where: { ...this.binWhere(req), reviewedAt: null } }) };
  }

  @Post('bin/:id/ignore')
  async ignore(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const item = await this.prisma.deletedRecord.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId, restoredAt: null } });
    await this.prisma.deletedRecord.update({ where: { id }, data: { reviewedAt: new Date(), reviewedById: req.user.id } });
    await this.audit.record(actorFrom(req), { action: 'recycle_bin.ignored', entityType: item.entityType, entityId: item.entityId, newValue: { label: item.label } });
    return { ignored: true };
  }

  /** Gone for good: the snapshot, and for files the Drive copy too. Cannot be undone. */
  @Delete('bin/:id')
  @HttpCode(204)
  async purge(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const item = await this.prisma.deletedRecord.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId, restoredAt: null } });
    if (item.entityType === 'file') {
      const row = unpackSnapshot(item.snapshot).row;
      await this.storage.remove(row.storageProvider as StorageProvider, (row.storageKey as string | null) ?? null);
    }
    await this.prisma.deletedRecord.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'recycle_bin.deleted_permanently', entityType: item.entityType, entityId: item.entityId, oldValue: { label: item.label, deletedAt: item.deletedAt } });
  }

  @Post('bin/:id/restore')
  async restore(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const item = await this.prisma.deletedRecord.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId, restoredAt: null } });
    const model = BIN_MODELS[item.entityType as BinEntity];
    if (!model) throw new BadRequestException('This kind of record cannot be restored');
    const { row, children } = unpackSnapshot(item.snapshot);
    type Delegate = { create(args: { data: unknown }): Promise<unknown>; createMany(args: { data: unknown[]; skipDuplicates: boolean }): Promise<unknown> };
    try {
      // The row first, then what was deleted along with it — all or nothing.
      await this.prisma.$transaction(async (tx) => {
        const models = tx as unknown as Record<string, Delegate>;
        await models[model].create({ data: row });
        for (const child of children) await models[child.model].createMany({ data: child.rows, skipDuplicates: true });
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException('A record with the same id or number already exists');
      if (code === 'P2003') throw new ConflictException('Something it belonged to (an event, team or module) no longer exists');
      throw err;
    }
    await this.prisma.deletedRecord.update({ where: { id }, data: { restoredAt: new Date(), reviewedAt: new Date(), reviewedById: req.user.id } });
    await this.audit.record(actorFrom(req), { action: 'recycle_bin.restored', entityType: item.entityType, entityId: item.entityId, newValue: { label: item.label } });
    return { restored: true, entityType: item.entityType, entityId: item.entityId };
  }

  // ── Backups ────────────────────────────────────────────────────

  @Get('backups')
  backupSettings() {
    return this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS);
  }

  @Put('backups')
  async setBackups(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(z.object({ enabled: z.boolean(), everyDays: z.coerce.number().int().min(1).max(60) }))) body: { enabled: boolean; everyDays: number }) {
    const current = await this.settings.get<BackupSettings>(BACKUPS_KEY, DEFAULT_BACKUPS);
    const saved = await this.settings.set(BACKUPS_KEY, { ...current, ...body }, req.user.id);
    await this.audit.record(actorFrom(req), { action: 'platform.backups_changed', entityType: 'system_setting', entityId: BACKUPS_KEY, oldValue: { enabled: current.enabled, everyDays: current.everyDays }, newValue: body });
    return saved;
  }

  @Get('backups/download')
  async downloadBackup(@Query(new ZodPipe(z.object({ key: z.string().min(1).max(300) }))) q: { key: string }, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const { name, buffer } = await this.backups.download(q.key);
    await this.audit.record(actorFrom(req), { action: 'platform.backup_downloaded', entityType: 'system_setting', entityId: BACKUPS_KEY, newValue: { name } });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  }

  @Post('backups/run')
  async runBackup(@Req() req: AuthenticatedRequest) {
    const entry = await this.backups.run(req.user.name);
    await this.audit.record(actorFrom(req), { action: 'platform.backup_created', entityType: 'system_setting', entityId: BACKUPS_KEY, newValue: entry });
    return entry;
  }

  // ── Two-person approvals ───────────────────────────────────────

  @Get('approvals')
  async approvals(@Req() req: AuthenticatedRequest) {
    const items = await this.prisma.changeRequest.findMany({ where: { organizationId: req.user.organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const ids = [...new Set(items.flatMap((i) => [i.requestedById, i.decidedById]).filter((x): x is string => !!x))];
    const names = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const name = (id: string | null) => names.find((n) => n.id === id) ?? null;
    return items.map((i) => ({ ...i, requestedBy: name(i.requestedById), decidedBy: name(i.decidedById), canDecide: i.status === 'PENDING' && i.requestedById !== req.user.id, canCancel: i.status === 'PENDING' && i.requestedById === req.user.id }));
  }

  @Post('approvals/:id/:decision')
  async decide(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('decision') decision: string) {
    if (!['approve', 'reject', 'cancel'].includes(decision)) throw new BadRequestException('Unknown decision');
    const request = await this.prisma.changeRequest.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId, status: 'PENDING' } });
    const mine = request.requestedById === req.user.id;
    if (decision === 'cancel' ? !mine : mine) {
      throw new ForbiddenException(decision === 'cancel' ? 'Only the requester can cancel' : 'A different Master Admin must decide on your own request');
    }

    let status: 'EXECUTED' | 'REJECTED' | 'CANCELLED' = decision === 'reject' ? 'REJECTED' : 'CANCELLED';
    let error: string | null = null;
    if (decision === 'approve') {
      try {
        await this.execute(req, request.kind, request.payload as Record<string, string>, request.requestedById);
        status = 'EXECUTED';
      } catch (err) {
        error = (err as Error).message;
        status = 'REJECTED';
      }
    }
    const saved = await this.prisma.changeRequest.update({ where: { id }, data: { status, decidedById: req.user.id, decidedAt: new Date(), error } });
    await this.audit.record(actorFrom(req), { action: `master.change_${status.toLowerCase()}`, entityType: 'change_request', entityId: id, newValue: { kind: request.kind, summary: request.summary, error } });
    await notify(this.prisma, { organizationId: req.user.organizationId, userIds: [request.requestedById], exceptUserId: req.user.id, type: 'master.approval_decided', title: `Your request was ${status === 'EXECUTED' ? 'approved and done' : status.toLowerCase()}`, body: error ?? request.summary, link: '/master/approvals' });
    if (error) throw new BadRequestException(`Approved, but it could not be carried out: ${error}`);
    return saved;
  }

  private async execute(req: AuthenticatedRequest, kind: string, payload: Record<string, string>, requestedById: string) {
    const orgId = req.user.organizationId;
    if (kind === 'GRANT_MASTER_ADMIN') {
      const [user, role] = await Promise.all([
        this.prisma.user.findFirstOrThrow({ where: { id: payload.userId, organizationId: orgId } }),
        this.prisma.role.findFirstOrThrow({ where: { id: payload.roleId, organizationId: orgId, isMasterAdmin: true } }),
      ]);
      await this.prisma.userRole.create({ data: { userId: user.id, roleId: role.id, scopeType: 'ORGANIZATION', assignedById: requestedById } });
      this.permissions.invalidate(orgId);
      await this.audit.record(actorFrom(req), { action: 'user.master_admin_granted', entityType: 'user', entityId: user.id, newValue: { user: user.email, role: role.name, requestedById, approvedById: req.user.id } });
    } else if (kind === 'DELETE_CUSTOM_MODULE') {
      await this.custom.remove(req.auth, actorFrom(req), payload.moduleId);
    } else {
      throw new Error(`Unknown change kind ${kind}`);
    }
  }

  // ── Undo from the audit log ────────────────────────────────────

  /** Only changes whose old value fully describes the previous state can be undone. */
  @Post('audit/:id/revert')
  async revert(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const orgId = req.user.organizationId;
    const entry = await this.prisma.auditLog.findFirstOrThrow({ where: { id, organizationId: orgId } });
    if (await this.prisma.auditLog.findFirst({ where: { action: 'audit.reverted', entityId: id } })) throw new ConflictException('This change was already undone');
    const oldValue = (entry.oldValue ?? {}) as Record<string, unknown>;
    const newValue = (entry.newValue ?? {}) as Record<string, unknown>;
    const cannot = () => new BadRequestException('This change cannot be undone automatically');

    switch (entry.action) {
      case 'user.disabled':
      case 'user.enabled': {
        const status = oldValue.status as 'ACTIVE' | 'INVITED' | 'DISABLED' | undefined;
        if (!status || !entry.entityId) throw cannot();
        await this.prisma.user.update({ where: { id: entry.entityId }, data: { status } });
        break;
      }
      case 'module.enabled':
      case 'module.disabled': {
        const status = oldValue.status as 'ENABLED' | 'DISABLED' | 'PLANNED' | undefined;
        const mod = entry.entityId ? await this.prisma.module.findUnique({ where: { key: entry.entityId } }) : null;
        if (!status || !mod || (mod.isCore && status === 'DISABLED')) throw cannot();
        await this.prisma.module.update({ where: { key: mod.key }, data: { status } });
        break;
      }
      case 'permission.access_changed': {
        const preset = oldValue.access as string;
        if (!entry.entityId || !newValue.scopeType || !newValue.moduleKey || !(PRESETS as readonly string[]).includes(preset)) throw cannot();
        await applyAccessPreset(this.prisma, { organizationId: orgId, scopeType: newValue.scopeType as 'USER', scopeId: entry.entityId, moduleKey: newValue.moduleKey as string, preset: preset as 'DEFAULT', expiresAt: null, userId: req.user.id });
        break;
      }
      case 'permission.override_set': {
        const override = entry.entityId ? await this.prisma.permissionOverride.findUnique({ where: { id: entry.entityId } }) : null;
        if (!override) throw cannot();
        if (oldValue.effect === 'INHERITED') await this.prisma.permissionOverride.delete({ where: { id: override.id } });
        else await this.prisma.permissionOverride.update({ where: { id: override.id }, data: { effect: oldValue.effect as 'ALLOW' | 'DENY' } });
        break;
      }
      case 'permission.override_removed': {
        if (!oldValue.scopeId || !oldValue.scopeType || !oldValue.permissionKey || !oldValue.effect) throw cannot();
        await this.prisma.permissionOverride.create({ data: { organizationId: orgId, scopeType: oldValue.scopeType as 'USER', scopeId: oldValue.scopeId as string, permissionKey: oldValue.permissionKey as string, effect: oldValue.effect as 'ALLOW', createdById: req.user.id } });
        break;
      }
      case 'platform.maintenance_changed':
        await this.settings.set(MAINTENANCE_KEY, oldValue as unknown as MaintenanceSetting, req.user.id);
        break;
      case 'platform.branding_changed':
        await this.settings.set(BRANDING_KEY, oldValue as unknown as BrandingSetting, req.user.id);
        break;
      default:
        throw cannot();
    }
    this.permissions.invalidate(orgId);
    await this.audit.record(actorFrom(req), { action: 'audit.reverted', entityType: 'audit_log', entityId: id, oldValue: { action: entry.action, newValue }, newValue: { restored: oldValue } });
    return { reverted: true };
  }

  // ── Announcements ──────────────────────────────────────────────

  @Get('announcements')
  announcements(@Req() req: AuthenticatedRequest) {
    return this.prisma.announcement.findMany({ where: { organizationId: req.user.organizationId }, orderBy: { startsAt: 'desc' }, take: 100 });
  }

  @Post('announcements')
  async createAnnouncement(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(announcementBody)) body: z.infer<typeof announcementBody>) {
    if (body.scopeType !== 'ORGANIZATION' && !body.scopeId) throw new BadRequestException('Choose who this announcement is for');
    const saved = await this.prisma.announcement.create({ data: { ...body, scopeId: body.scopeType === 'ORGANIZATION' ? null : body.scopeId, organizationId: req.user.organizationId, createdById: req.user.id } });
    await this.audit.record(actorFrom(req), { action: 'announcement.created', entityType: 'announcement', entityId: saved.id, newValue: body });
    return saved;
  }

  @Patch('announcements/:id')
  async updateAnnouncement(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(announcementBody.partial())) body: Partial<z.infer<typeof announcementBody>>) {
    const before = await this.prisma.announcement.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const saved = await this.prisma.announcement.update({ where: { id }, data: body });
    await this.audit.record(actorFrom(req), { action: 'announcement.updated', entityType: 'announcement', entityId: id, oldValue: { title: before.title, endsAt: before.endsAt }, newValue: body });
    return saved;
  }

  @Delete('announcements/:id')
  @HttpCode(204)
  async deleteAnnouncement(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.announcement.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'announcement.deleted', entityType: 'announcement', entityId: id, oldValue: { title: before.title } });
  }

  // ── Automation rules ───────────────────────────────────────────

  @Get('automations')
  async rules(@Req() req: AuthenticatedRequest) {
    const rules = await this.prisma.automationRule.findMany({ where: { organizationId: req.user.organizationId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { firings: true } } } });
    return {
      triggers: TRIGGER_KEYS.map((key) => ({ key, label: TRIGGERS[key].label })),
      rules: rules.map((r) => ({ ...r, description: describeRule(r.trigger as Trigger, r.config) })),
    };
  }

  @Post('automations')
  async createRule(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(ruleBody)) body: z.infer<typeof ruleBody>) {
    const config = this.validConfig(body.trigger, body.config);
    const saved = await this.prisma.automationRule.create({ data: { ...body, config, organizationId: req.user.organizationId, createdById: req.user.id } });
    await this.audit.record(actorFrom(req), { action: 'automation.created', entityType: 'automation_rule', entityId: saved.id, newValue: { ...body, config } });
    return saved;
  }

  @Patch('automations/:id')
  async updateRule(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ruleBody.partial())) body: Partial<z.infer<typeof ruleBody>>) {
    const before = await this.prisma.automationRule.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const trigger = (body.trigger ?? before.trigger) as Trigger;
    const config = body.config || body.trigger ? this.validConfig(trigger, body.config ?? before.config) : undefined;
    const saved = await this.prisma.automationRule.update({ where: { id }, data: { ...body, ...(config && { config }) } });
    await this.audit.record(actorFrom(req), { action: 'automation.updated', entityType: 'automation_rule', entityId: id, oldValue: { name: before.name, enabled: before.enabled, config: before.config }, newValue: body });
    return saved;
  }

  @Delete('automations/:id')
  @HttpCode(204)
  async deleteRule(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.automationRule.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.prisma.automationRule.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'automation.deleted', entityType: 'automation_rule', entityId: id, oldValue: { name: before.name, trigger: before.trigger } });
  }

  /** Runs one rule now instead of waiting for the timer (weekly report runs regardless of its schedule). */
  @Post('automations/:id/run')
  async runRule(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const rule = await this.prisma.automationRule.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    if (rule.trigger === 'EXPENSE_TWO_APPROVERS') throw new BadRequestException('This rule applies when an expense is approved; there is nothing to run');
    await this.automation.runRule({ ...rule, lastRunAt: null }, new Date());
    await this.audit.record(actorFrom(req), { action: 'automation.run', entityType: 'automation_rule', entityId: id, newValue: { name: rule.name } });
    return { ran: true };
  }

  private validConfig(trigger: Trigger, config: unknown) {
    const parsed = TRIGGERS[trigger].schema.safeParse(config ?? {});
    if (!parsed.success) throw new BadRequestException(`Invalid settings for "${TRIGGERS[trigger].label}"`);
    return parseConfig(trigger, config) as object;
  }
}

/** Leaving a preview must work from the user plane, where the Master console is not reachable. */
@Controller('view-as')
export class ViewAsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Delete()
  @HttpCode(204)
  async exit(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token: string | undefined = req.cookies?.[VIEW_AS_COOKIE];
    if (token) {
      const session = await this.sessions.resolve(token);
      await this.sessions.revokeByToken(token);
      if (session?.impersonatorId) {
        await this.audit.record(
          { userId: session.impersonatorId, organizationId: session.user.organizationId, ip: req.ip, userAgent: req.headers['user-agent'] },
          { action: 'master.view_as.ended', entityType: 'user', entityId: session.userId },
        );
      }
    }
    res.clearCookie(VIEW_AS_COOKIE, { path: '/' });
  }
}

@Module({
  imports: [AutomationModule, CustomModulesModule, IntegrationsModule],
  controllers: [ControlController, ViewAsController],
})
export class ControlModule {}

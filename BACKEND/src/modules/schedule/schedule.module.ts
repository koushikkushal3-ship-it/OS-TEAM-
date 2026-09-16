import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
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
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { MasterOnly, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GoogleCalendarService } from '../integrations/google-calendar.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { recycle } from '../platform/records.js';
import { toGoogleEvent } from './google-event.js';

const SCOPES = ['ORGANIZATION', 'DEPARTMENT', 'TEAM', 'EVENT'] as const;
const PENDING_DELETES_KEY = 'integrations.google_calendar.pending_deletes';

const entryBody = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(3000).nullish(),
    location: z.string().trim().max(300).nullish(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    allDay: z.boolean().default(false),
    scopeType: z.enum(SCOPES).default('ORGANIZATION'),
    scopeId: z.string().uuid().nullish(),
    category: z.string().trim().min(2).max(40).default('General'),
  })
  .refine((v) => v.endsAt >= v.startsAt, { message: 'The end must be after the start', path: ['endsAt'] })
  .refine((v) => v.scopeType === 'ORGANIZATION' || !!v.scopeId, { message: 'Choose who this is for', path: ['scopeId'] });
type EntryInput = z.infer<typeof entryBody>;

const rangeQuery = z.object({ from: z.coerce.date(), to: z.coerce.date() });

/** Entries a person may see: organization-wide, plus their department, teams and events. */
export function scheduleVisibility(auth: Pick<AuthContext, 'organizationId' | 'departmentId' | 'teamIds' | 'eventIds'>) {
  return {
    organizationId: auth.organizationId,
    OR: [
      { scopeType: 'ORGANIZATION' },
      ...(auth.departmentId ? [{ scopeType: 'DEPARTMENT', scopeId: auth.departmentId }] : []),
      { scopeType: 'TEAM', scopeId: { in: auth.teamIds } },
      { scopeType: 'EVENT', scopeId: { in: auth.eventIds } },
    ],
  };
}

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly calendar: GoogleCalendarService,
    private readonly settings: PlatformSettingsService,
  ) {}

  private target(input: { scopeType: string; scopeId?: string | null }) {
    return input.scopeType === 'TEAM' ? { teamId: input.scopeId ?? undefined } : input.scopeType === 'EVENT' ? { eventId: input.scopeId ?? undefined } : {};
  }

  /** Workers read; admins, Master Admin and leads write — leads within the team or event they lead. */
  private canManage(auth: AuthContext, input: { scopeType: string; scopeId?: string | null }) {
    return this.permissions.can(auth, 'schedule.manage', this.target(input));
  }

  private async assertScope(organizationId: string, input: { scopeType: string; scopeId?: string | null }) {
    if (input.scopeType === 'ORGANIZATION') return;
    const where = { id: input.scopeId!, organizationId };
    const found =
      input.scopeType === 'DEPARTMENT' ? await this.prisma.department.count({ where }) : input.scopeType === 'TEAM' ? await this.prisma.team.count({ where }) : await this.prisma.event.count({ where });
    if (!found) throw new BadRequestException(`That ${input.scopeType.toLowerCase()} does not exist`);
  }

  async audience(entry: { scopeType: string; scopeId: string | null }) {
    if (entry.scopeType === 'ORGANIZATION' || !entry.scopeId) return 'Everyone';
    const select = { name: true } as const;
    const row =
      entry.scopeType === 'DEPARTMENT'
        ? await this.prisma.department.findUnique({ where: { id: entry.scopeId }, select })
        : entry.scopeType === 'TEAM'
          ? await this.prisma.team.findUnique({ where: { id: entry.scopeId }, select })
          : await this.prisma.event.findUnique({ where: { id: entry.scopeId }, select });
    return row?.name ?? entry.scopeType.toLowerCase();
  }

  async list(auth: AuthContext, from: Date, to: Date) {
    const manager = await this.permissions.can(auth, 'schedule.manage');
    // Anyone who manages the schedule sees every entry so they can keep it tidy.
    const visible = manager ? { organizationId: auth.organizationId } : scheduleVisibility(auth);
    const rows = await this.prisma.scheduleEntry.findMany({
      where: { ...visible, startsAt: { lte: to }, endsAt: { gte: from } },
      orderBy: { startsAt: 'asc' },
      take: 1000,
    });
    const items = [];
    for (const row of rows) {
      items.push({
        ...row,
        audience: await this.audience(row),
        canEdit: manager && (await this.canManage(auth, row)),
        googleSynced: !!row.googleSyncedAt && row.googleSyncedAt >= row.updatedAt,
      });
    }
    return { items, capabilities: { canManage: manager }, google: await this.calendar.status().then((s) => ({ connected: s.connected, calendarUrl: s.calendarUrl })) };
  }

  async create(auth: AuthContext, actor: AuditActor, input: EntryInput) {
    if (!(await this.canManage(auth, input))) throw new ForbiddenException('You cannot add schedule entries for this audience');
    await this.assertScope(auth.organizationId, input);
    const entry = await this.prisma.scheduleEntry.create({
      data: { ...input, scopeId: input.scopeType === 'ORGANIZATION' ? null : input.scopeId, organizationId: auth.organizationId, createdById: auth.userId, updatedById: auth.userId },
    });
    await this.audit.record(actor, { action: 'schedule.created', entityType: 'schedule_entry', entityId: entry.id, newValue: input });
    await this.push(entry.id);
    return this.prisma.scheduleEntry.findUniqueOrThrow({ where: { id: entry.id } });
  }

  async update(auth: AuthContext, actor: AuditActor, id: string, input: EntryInput) {
    const before = await this.prisma.scheduleEntry.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, before)) || !(await this.canManage(auth, input))) throw new ForbiddenException('You cannot edit this schedule entry');
    await this.assertScope(auth.organizationId, input);
    await this.prisma.scheduleEntry.update({
      where: { id },
      data: { ...input, scopeId: input.scopeType === 'ORGANIZATION' ? null : input.scopeId, updatedById: auth.userId },
    });
    await this.audit.record(actor, {
      action: 'schedule.updated',
      entityType: 'schedule_entry',
      entityId: id,
      oldValue: { title: before.title, startsAt: before.startsAt, endsAt: before.endsAt, scopeType: before.scopeType },
      newValue: input,
    });
    await this.push(id);
    return this.prisma.scheduleEntry.findUniqueOrThrow({ where: { id } });
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.scheduleEntry.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, before))) throw new ForbiddenException('You cannot remove this schedule entry');
    // A restore re-creates the Google copy, so the snapshot forgets the old one.
    const row = { ...before, googleEventId: null, googleSyncedAt: null, googleSyncError: null };
    await recycle(this.prisma, {
      organizationId: auth.organizationId,
      entityType: 'schedule_entry',
      row,
      label: before.title,
      deletedById: auth.userId,
    });
    await this.prisma.scheduleEntry.delete({ where: { id } });
    await this.audit.record(actor, { action: 'schedule.deleted', entityType: 'schedule_entry', entityId: id, oldValue: { title: before.title, startsAt: before.startsAt } });
    if (before.googleEventId) await this.deleteFromGoogle(before.googleEventId);
  }

  // ── Google Calendar mirror ─────────────────────────────────────

  /** Best effort: the portal is the source of truth; a failed copy is retried by the automation timer. */
  async push(id: string) {
    if (!(await this.calendar.status()).connected) return;
    const entry = await this.prisma.scheduleEntry.findUnique({ where: { id } });
    if (!entry) return;
    const now = new Date();
    try {
      const event = toGoogleEvent(entry, await this.audience(entry), `${env.FRONTEND_URL}/schedule`);
      const googleEventId = await this.calendar.upsertEvent(entry.googleEventId, event);
      // updatedAt is set explicitly so "synced" means googleSyncedAt >= updatedAt.
      await this.prisma.scheduleEntry.update({ where: { id }, data: { googleEventId, googleSyncedAt: now, googleSyncError: null, updatedAt: now } });
    } catch (err) {
      await this.prisma.scheduleEntry.update({ where: { id }, data: { googleSyncError: (err as Error).message.slice(0, 300), updatedAt: entry.updatedAt } });
    }
  }

  private async deleteFromGoogle(googleEventId: string) {
    try {
      await this.calendar.deleteEvent(googleEventId);
    } catch {
      const pending = await this.settings.get<{ ids: string[] }>(PENDING_DELETES_KEY, { ids: [] });
      await this.settings.set(PENDING_DELETES_KEY, { ids: [...new Set([...pending.ids, googleEventId])] });
    }
  }

  /** Copies every entry that is new or changed since its last copy, retries deletions, and refreshes sharing. */
  async syncAll() {
    if (!(await this.calendar.status()).connected) return { connected: false, synced: 0, failed: 0, deleted: 0, sharing: null };
    const due = await this.prisma.scheduleEntry.findMany({
      where: { OR: [{ googleSyncedAt: null }, { updatedAt: { gt: this.prisma.scheduleEntry.fields.googleSyncedAt } }] },
      select: { id: true },
      take: 500,
    });
    for (const { id } of due) await this.push(id);
    const failed = await this.prisma.scheduleEntry.count({ where: { googleSyncError: { not: null } } });

    const pending = await this.settings.get<{ ids: string[] }>(PENDING_DELETES_KEY, { ids: [] });
    const stillPending: string[] = [];
    for (const googleEventId of pending.ids) {
      try {
        await this.calendar.deleteEvent(googleEventId);
      } catch {
        stillPending.push(googleEventId);
      }
    }
    if (pending.ids.length) await this.settings.set(PENDING_DELETES_KEY, { ids: stillPending });

    let sharing: { added: number; removed: number } | { error: string } | null = null;
    try {
      const members = await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { email: true } });
      sharing = await this.calendar.syncReaders(members.map((m) => m.email));
    } catch (err) {
      this.logger.warn(`Calendar sharing: ${(err as Error).message}`);
      sharing = { error: (err as Error).message };
    }
    return { connected: true, synced: due.length - failed, failed, deleted: pending.ids.length - stillPending.length, sharing };
  }
}

@Controller('schedule')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get()
  @RequirePermission('schedule.view')
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    if (q.to.getTime() - q.from.getTime() > 400 * 86_400_000) throw new BadRequestException('Range is too long');
    return this.schedule.list(req.auth, q.from, q.to);
  }

  @Post()
  @RequirePermission('schedule.manage')
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(entryBody)) body: EntryInput) {
    return this.schedule.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  @RequirePermission('schedule.manage')
  update(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(entryBody)) body: EntryInput) {
    return this.schedule.update(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('schedule.manage')
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.schedule.remove(req.auth, actorFrom(req), id);
  }
}

const CALENDAR_STATE_COOKIE = 'teamos_calendar_state';

/** Master Admin → Integrations → Google Calendar. */
@MasterOnly()
@Controller('integrations/google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly calendar: GoogleCalendarService,
    private readonly schedule: ScheduleService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async status() {
    const [status, unsynced] = await Promise.all([
      this.calendar.status(),
      this.prisma.scheduleEntry.count({ where: { OR: [{ googleSyncedAt: null }, { googleSyncError: { not: null } }] } }),
    ]);
    return { ...status, unsynced };
  }

  @Get('connect')
  connect(@Res() res: Response) {
    const state = randomBytes(24).toString('base64url');
    res.cookie(CALENDAR_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 10 * 60_000 });
    return res.redirect(this.calendar.authUrl(state));
  }

  @Get('callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const expected = req.cookies?.[CALENDAR_STATE_COOKIE];
    res.clearCookie(CALENDAR_STATE_COOKIE, { path: '/' });
    const page = `${env.FRONTEND_URL}/master/integrations`;
    if (!code || !state || state !== expected) return res.redirect(`${page}?calendarError=invalid_state`);
    try {
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } });
      const status = await this.calendar.connect(code, req.user.id, org.name);
      await this.audit.record(actorFrom(req), { action: 'integration.google_calendar_connected', entityType: 'integration', entityId: 'google_calendar', newValue: { account: status.connectedEmail, calendar: status.calendarName } });
      // Copy everything already in the schedule and share the calendar straight away.
      void this.schedule.syncAll().catch(() => undefined);
      return res.redirect(`${page}?calendar=connected`);
    } catch (err) {
      return res.redirect(`${page}?calendarError=${encodeURIComponent((err as Error).message).slice(0, 200)}`);
    }
  }

  @Post('disconnect')
  @HttpCode(204)
  async disconnect(@Req() req: AuthenticatedRequest) {
    const before = await this.calendar.status();
    await this.calendar.disconnect();
    await this.prisma.scheduleEntry.updateMany({ data: { googleSyncedAt: null, googleSyncError: null } });
    await this.audit.record(actorFrom(req), { action: 'integration.google_calendar_disconnected', entityType: 'integration', entityId: 'google_calendar', oldValue: { account: before.connectedEmail } });
  }

  @Post('sync')
  async sync(@Req() req: AuthenticatedRequest) {
    const result = await this.schedule.syncAll();
    await this.audit.record(actorFrom(req), { action: 'integration.google_calendar_synced', entityType: 'integration', entityId: 'google_calendar', newValue: result });
    return result;
  }

  @Put('sharing')
  async sharing(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(z.object({ shareWithMembers: z.boolean() }))) body: { shareWithMembers: boolean }) {
    const before = await this.calendar.status();
    await this.calendar.setSharing(body.shareWithMembers);
    await this.audit.record(actorFrom(req), { action: 'integration.google_calendar_sharing', entityType: 'integration', entityId: 'google_calendar', oldValue: { shareWithMembers: before.shareWithMembers }, newValue: body });
    return this.schedule.syncAll();
  }
}

@Module({
  imports: [IntegrationsModule],
  controllers: [ScheduleController, GoogleCalendarController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}

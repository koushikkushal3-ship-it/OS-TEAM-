import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { Public, RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { PlatformSettingsService } from '../platform/platform-settings.service.js';
import { notify, teamLeadsOf } from '../platform/records.js';

const person = { select: { id: true, name: true, avatarUrl: true } } as const;

// ── Notifications ────────────────────────────────────────────────────────────

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ unread: z.coerce.boolean().optional() }))) q: { unread?: boolean }) {
    return this.prisma.notification.findMany({
      where: { userId: req.user.id, ...(q.unread && { readAt: null }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Get('unread-count')
  async unreadCount(@Req() req: AuthenticatedRequest) {
    return { count: await this.prisma.notification.count({ where: { userId: req.user.id, readAt: null } }) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@Req() req: AuthenticatedRequest) {
    await this.prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  }
}

// ── Announcements (reading side; Master Admin writes them) ───────────────────

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Announcements aimed at the whole organization or at a department, team or event this person is in. */
  @Get('active')
  active(@Req() req: AuthenticatedRequest) {
    const now = new Date();
    const auth = req.auth;
    return this.prisma.announcement.findMany({
      where: {
        organizationId: auth.organizationId,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [
          {
            OR: [
              { scopeType: 'ORGANIZATION' },
              ...(auth.departmentId ? [{ scopeType: 'DEPARTMENT', scopeId: auth.departmentId }] : []),
              { scopeType: 'TEAM', scopeId: { in: auth.teamIds } },
              { scopeType: 'EVENT', scopeId: { in: auth.eventIds } },
            ],
          },
        ],
      },
      orderBy: { startsAt: 'desc' },
      take: 5,
    });
  }
}

// ── Kudos ────────────────────────────────────────────────────────────────────

const kudosBody = z.object({ toId: z.string().uuid(), message: z.string().trim().min(3).max(500) });

@Controller('kudos')
export class KudosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('kudos.view')
  async list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ userId: z.string().uuid().optional() }))) q: { userId?: string }) {
    const where = { organizationId: req.user.organizationId, ...(q.userId && { toId: q.userId }) };
    const [items, received] = await Promise.all([
      this.prisma.kudos.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, include: { from: person, to: person } }),
      q.userId ? this.prisma.kudos.count({ where: { toId: q.userId } }) : Promise.resolve(null),
    ]);
    return { items, received };
  }

  @Post()
  @RequirePermission('kudos.give')
  async give(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(kudosBody)) body: z.infer<typeof kudosBody>) {
    if (body.toId === req.user.id) throw new BadRequestException('Kudos are for someone else');
    await this.prisma.user.findFirstOrThrow({ where: { id: body.toId, organizationId: req.user.organizationId, status: { not: 'DISABLED' } } });
    const kudos = await this.prisma.kudos.create({
      data: { ...body, organizationId: req.user.organizationId, fromId: req.user.id },
      include: { from: person, to: person },
    });
    await this.audit.record(actorFrom(req), { action: 'kudos.given', entityType: 'kudos', entityId: kudos.id, newValue: { to: kudos.to.name } });
    await notify(this.prisma, {
      organizationId: req.user.organizationId,
      userIds: [body.toId],
      type: 'kudos.received',
      title: `${req.user.name} thanked you`,
      body: body.message,
      link: '/kudos',
    });
    return kudos;
  }
}

// ── Leave ────────────────────────────────────────────────────────────────────

const leaveBody = z
  .object({
    type: z.enum(['Leave', 'Sick', 'Unavailable', 'Exam', 'Travel']).default('Leave'),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });
const leaveList = z.object({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});
const leaveReview = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).nullish() });

@Controller('leave')
export class LeaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(leaveList)) q: z.infer<typeof leaveList>) {
    const auth = req.auth;
    let who: object = { userId: auth.userId };
    if (q.scope === 'all') {
      await this.permissions.assert(auth, 'leave.approve');
      who = {};
    } else if (q.scope === 'team') {
      const led = await this.prisma.teamMember.findMany({ where: { userId: auth.userId, memberRole: { in: ['LEAD', 'CO_LEAD'] } }, select: { teamId: true } });
      who = { user: { teamMemberships: { some: { teamId: { in: led.map((t) => t.teamId) } } } } };
    }
    return this.prisma.leaveRequest.findMany({
      where: { organizationId: auth.organizationId, ...who, ...(q.status && { status: q.status }) },
      orderBy: { startDate: 'desc' },
      take: 200,
      include: { user: person, reviewedBy: { select: { id: true, name: true } } },
    });
  }

  @Post()
  @RequirePermission('leave.request')
  async request(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(leaveBody)) body: z.infer<typeof leaveBody>) {
    const leave = await this.prisma.leaveRequest.create({
      data: { ...body, organizationId: req.user.organizationId, userId: req.user.id },
      include: { user: person },
    });
    await this.audit.record(actorFrom(req), { action: 'leave.requested', entityType: 'leave', entityId: leave.id, newValue: body });
    const leads = await teamLeadsOf(this.prisma, req.user.id);
    await notify(this.prisma, {
      organizationId: req.user.organizationId,
      userIds: leads.length ? leads : await this.permissions.usersWith(req.user.organizationId, 'leave.approve'),
      exceptUserId: req.user.id,
      type: 'leave.requested',
      title: `${req.user.name} requested ${body.type.toLowerCase()}`,
      body: `${body.startDate.toDateString()} – ${body.endDate.toDateString()}`,
      link: '/leave',
    });
    return leave;
  }

  @Post(':id/review')
  @RequirePermission('leave.approve')
  async review(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leaveReview)) body: z.infer<typeof leaveReview>) {
    const before = await this.prisma.leaveRequest.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    if (before.userId === req.user.id) throw new ForbiddenException('Someone else must review your own leave');
    if (before.status !== 'PENDING') throw new BadRequestException('This request was already decided');
    const status = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const leave = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status, reviewedById: req.user.id, reviewedAt: new Date(), reviewNote: body.note },
      include: { user: person },
    });
    await this.audit.record(actorFrom(req), { action: `leave.${status.toLowerCase()}`, entityType: 'leave', entityId: id, oldValue: { status: before.status }, newValue: { status, note: body.note } });
    await notify(this.prisma, {
      organizationId: req.user.organizationId,
      userIds: [before.userId],
      type: 'leave.reviewed',
      title: `Your ${before.type.toLowerCase()} request was ${status.toLowerCase()}`,
      body: body.note,
      link: '/leave',
    });
    return leave;
  }

  @Post(':id/cancel')
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.leaveRequest.findFirstOrThrow({ where: { id, userId: req.user.id } });
    if (!['PENDING', 'APPROVED'].includes(before.status)) throw new BadRequestException('Only pending or approved leave can be cancelled');
    await this.audit.record(actorFrom(req), { action: 'leave.cancelled', entityType: 'leave', entityId: id, oldValue: { status: before.status } });
    return this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}

// ── Global search ────────────────────────────────────────────────────────────

@Controller('search')
export class SearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  /** Searches only what this person could already open from the menus. */
  @Get()
  async search(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ q: z.string().trim().min(2).max(100) }))) { q }: { q: string }) {
    const auth = req.auth;
    const org = auth.organizationId;
    const text = { contains: q, mode: 'insensitive' as const };
    const can = (action: string, t?: { teamId?: string | null; eventId?: string | null }) =>
      this.permissions.can(auth, action, { teamId: t?.teamId ?? undefined, eventId: t?.eventId ?? undefined });

    const [people, teams, events, tasks, meetings, tickets, ideas, files] = await Promise.all([
      (await can('user.view')) ? this.prisma.user.findMany({ where: { organizationId: org, status: { not: 'DISABLED' }, OR: [{ name: text }, { email: text }] }, select: { id: true, name: true, email: true, avatarUrl: true }, take: 6 }) : [],
      (await can('team.view')) ? this.prisma.team.findMany({ where: { organizationId: org, isActive: true, name: text }, select: { id: true, name: true }, take: 5 }) : [],
      (await can('event.view')) ? this.prisma.event.findMany({ where: { organizationId: org, name: text }, select: { id: true, name: true, status: true }, take: 5 }) : [],
      this.prisma.task.findMany({ where: { organizationId: org, title: text }, select: { id: true, title: true, status: true, teamId: true, eventId: true, assignedToId: true, createdById: true }, take: 20 }),
      this.prisma.meeting.findMany({ where: { organizationId: org, title: text }, select: { id: true, title: true, scheduledStart: true, teamId: true, eventId: true, participants: { where: { userId: auth.userId }, select: { userId: true } } }, take: 20 }),
      this.prisma.ticket.findMany({ where: { organizationId: org, OR: [{ title: text }, ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : [])] }, select: { id: true, number: true, title: true, status: true, teamId: true, eventId: true, requesterId: true, assigneeId: true }, take: 20 }),
      this.prisma.idea.findMany({ where: { organizationId: org, title: text }, select: { id: true, title: true, status: true, teamId: true, eventId: true }, take: 20 }),
      (await can('document.view')) ? this.prisma.fileRecord.findMany({ where: { organizationId: org, name: text }, select: { id: true, name: true, entityType: true, entityId: true }, take: 6 }) : [],
    ]);

    const keep = async <T>(rows: T[], test: (row: T) => Promise<boolean> | boolean, limit = 6) => {
      const out: T[] = [];
      for (const row of rows) {
        if (out.length >= limit) break;
        if (await test(row)) out.push(row);
      }
      return out;
    };

    return {
      people,
      teams,
      events,
      tasks: await keep(tasks, (t) => t.assignedToId === auth.userId || t.createdById === auth.userId || auth.teamIds.includes(t.teamId ?? '') || can('task.view', t)),
      meetings: await keep(meetings, (m) => m.participants.length > 0 || can('meeting.manage', m)),
      tickets: await keep(tickets, (t) => t.requesterId === auth.userId || t.assigneeId === auth.userId || can('ticket.update', t)),
      ideas: await keep(ideas, (i) => can('idea.view', i)),
      files,
    };
  }
}

// ── Branding (public: the sign-in page needs it) ─────────────────────────────

@Controller('platform')
export class PlatformController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Public()
  @Get('branding')
  branding() {
    return this.settings.branding();
  }
}

@Module({
  controllers: [NotificationsController, AnnouncementsController, KudosController, LeaveController, SearchController, PlatformController],
})
export class WorkspaceModule {}

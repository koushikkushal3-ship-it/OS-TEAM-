import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { notify, recycle } from '../platform/records.js';

const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const OPEN_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED'] as const;

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).nullish(),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  teamId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  assigneeId: z.string().uuid().nullish(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(STATUSES).optional(),
  resolution: z.string().trim().max(2000).nullish(),
});

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  open: z.coerce.boolean().optional(),
  mine: z.coerce.boolean().optional(),
  teamId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
});

const commentSchema = z.object({ message: z.string().trim().min(1).max(2000) });

const ticketSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  resolution: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  teamId: true,
  eventId: true,
  team: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true, avatarUrl: true } },
  assignee: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { activity: true } },
} as const;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: z.infer<typeof listSchema>) {
    const broadView = await this.permissions.can(auth, 'ticket.view');
    const rows = await this.prisma.ticket.findMany({
      where: {
        organizationId: auth.organizationId,
        status: q.status,
        teamId: q.teamId,
        eventId: q.eventId,
        ...(q.open && { status: { in: [...OPEN_STATUSES] } }),
        ...(q.mine && { OR: [{ requesterId: auth.userId }, { assigneeId: auth.userId }] }),
        ...(!broadView && {
          OR: [{ requesterId: auth.userId }, { assigneeId: auth.userId }, { teamId: { in: auth.teamIds } }],
        }),
      },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: q.limit,
      select: ticketSelect,
    });

    const visible = [];
    for (const row of rows) if (await this.canSee(auth, row)) visible.push(row);
    return visible;
  }

  async get(auth: AuthContext, id: string) {
    const ticket = await this.prisma.ticket.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      select: {
        ...ticketSelect,
        activity: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, kind: true, message: true, createdAt: true, user: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
    });
    if (!(await this.canSee(auth, ticket))) throw new ForbiddenException('You cannot view this ticket');

    const target = { teamId: ticket.teamId ?? undefined, eventId: ticket.eventId ?? undefined };
    const [canUpdate, canAssign] = await Promise.all([
      this.permissions.can(auth, 'ticket.update', target),
      this.permissions.can(auth, 'ticket.assign', target),
    ]);
    return { ...ticket, capabilities: { canUpdate, canAssign } };
  }

  async create(auth: AuthContext, actor: AuditActor, input: z.infer<typeof createSchema>) {
    const target = { teamId: input.teamId ?? undefined, eventId: input.eventId ?? undefined };
    await this.permissions.assert(auth, 'ticket.create', target);
    if (input.assigneeId) await this.permissions.assert(auth, 'ticket.assign', target);
    await this.assertRefs(auth, input);

    // Ticket numbers count up per organization so people can say "ticket 42".
    const last = await this.prisma.ticket.findFirst({
      where: { organizationId: auth.organizationId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const ticket = await this.prisma.ticket.create({
      data: {
        ...input,
        organizationId: auth.organizationId,
        number: (last?.number ?? 0) + 1,
        requesterId: auth.userId,
        status: input.assigneeId ? 'ASSIGNED' : 'OPEN',
      },
      select: ticketSelect,
    });
    await this.audit.record(actor, {
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: ticket.id,
      newValue: { number: ticket.number, title: ticket.title, priority: ticket.priority, assigneeId: input.assigneeId },
    });
    await notify(this.prisma, {
      organizationId: auth.organizationId,
      userIds: [input.assigneeId],
      exceptUserId: auth.userId,
      type: 'ticket.assigned',
      title: `Ticket #${ticket.number}: ${ticket.title}`,
      link: '/tickets',
    });
    return ticket;
  }

  async update(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof updateSchema>) {
    const before = await this.prisma.ticket.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    const target = { teamId: before.teamId ?? undefined, eventId: before.eventId ?? undefined };

    // The person who raised it can still edit the description while it is open.
    const ownWhileOpen = before.requesterId === auth.userId && (OPEN_STATUSES as readonly string[]).includes(before.status);
    if (!ownWhileOpen) await this.permissions.assert(auth, 'ticket.update', target);
    if (input.assigneeId !== undefined && input.assigneeId !== before.assigneeId) {
      await this.permissions.assert(auth, 'ticket.assign', target);
    }
    await this.assertRefs(auth, input);

    const resolving = input.status === 'RESOLVED' && before.status !== 'RESOLVED';
    const closing = input.status === 'CLOSED' && before.status !== 'CLOSED';
    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: {
        ...input,
        ...(resolving && { resolvedAt: new Date() }),
        ...(closing && { closedAt: new Date() }),
        ...(input.status && !['RESOLVED', 'CLOSED'].includes(input.status) && { resolvedAt: null, closedAt: null }),
      },
      select: ticketSelect,
    });

    // State changes read better as a timeline entry than as a silent field edit.
    const changes: string[] = [];
    if (input.status && input.status !== before.status) changes.push(`Status: ${before.status} → ${input.status}`);
    if (input.assigneeId !== undefined && input.assigneeId !== before.assigneeId) changes.push('Assignee changed');
    if (input.priority && input.priority !== before.priority) changes.push(`Priority: ${before.priority} → ${input.priority}`);
    if (changes.length) {
      await this.prisma.ticketActivity.create({
        data: { ticketId: id, userId: auth.userId, kind: 'change', message: changes.join(' · ') },
      });
    }

    await this.audit.record(actor, {
      action: input.status && input.status !== before.status ? `ticket.${input.status.toLowerCase()}` : 'ticket.updated',
      entityType: 'ticket',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])),
      newValue: input,
    });
    return ticket;
  }

  async comment(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof commentSchema>) {
    const ticket = await this.prisma.ticket.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canSee(auth, ticket))) throw new ForbiddenException('You cannot comment on this ticket');

    const entry = await this.prisma.ticketActivity.create({
      data: { ticketId: id, userId: auth.userId, kind: 'comment', message: input.message },
      select: { id: true, kind: true, message: true, createdAt: true, user: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await this.audit.record(actor, { action: 'ticket.commented', entityType: 'ticket', entityId: id, newValue: { message: input.message } });
    return entry;
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.ticket.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'ticket.update', {
      teamId: before.teamId ?? undefined,
      eventId: before.eventId ?? undefined,
    });
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'ticket', row: before, label: `#${before.number} ${before.title}`, deletedById: auth.userId, children: [{ model: 'ticketActivity', rows: await this.prisma.ticketActivity.findMany({ where: { ticketId: id } }) }] });
    await this.prisma.ticket.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'ticket.deleted',
      entityType: 'ticket',
      entityId: id,
      oldValue: { number: before.number, title: before.title },
    });
  }

  async stats(auth: AuthContext, q: { teamId?: string; eventId?: string }) {
    const where = { organizationId: auth.organizationId, teamId: q.teamId, eventId: q.eventId };
    const byStatus = await this.prisma.ticket.groupBy({ by: ['status'], where, _count: true });
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    return {
      total: byStatus.reduce((n, s) => n + s._count, 0),
      open: OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0),
      blocked: counts.BLOCKED ?? 0,
      resolved: counts.RESOLVED ?? 0,
      closed: counts.CLOSED ?? 0,
      byStatus: counts,
    };
  }

  /** Requester and assignee always see their ticket; others need ticket.view in scope. */
  private async canSee(auth: AuthContext, ticket: { teamId: string | null; eventId: string | null; requester?: { id: string } | null; assignee?: { id: string } | null; requesterId?: string | null; assigneeId?: string | null }) {
    const requester = ticket.requester?.id ?? ticket.requesterId;
    const assignee = ticket.assignee?.id ?? ticket.assigneeId;
    if (requester === auth.userId || assignee === auth.userId) return true;
    return this.permissions.can(auth, 'ticket.view', {
      teamId: ticket.teamId ?? undefined,
      eventId: ticket.eventId ?? undefined,
    });
  }

  private async assertRefs(auth: AuthContext, input: { teamId?: string | null; eventId?: string | null; assigneeId?: string | null }) {
    const organizationId = auth.organizationId;
    if (input.teamId && !(await this.prisma.team.count({ where: { id: input.teamId, organizationId } }))) {
      throw new BadRequestException('Team not found');
    }
    if (input.eventId && !(await this.prisma.event.count({ where: { id: input.eventId, organizationId } }))) {
      throw new BadRequestException('Event not found');
    }
    if (input.assigneeId && !(await this.prisma.user.count({ where: { id: input.assigneeId, organizationId, status: { not: 'DISABLED' } } }))) {
      throw new BadRequestException('Assignee not found');
    }
  }
}

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.tickets.list(req.auth, q);
  }

  @Get('stats')
  @RequirePermission('ticket.view')
  stats(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ teamId: z.string().uuid().optional(), eventId: z.string().uuid().optional() }))) q: { teamId?: string; eventId?: string }) {
    return this.tickets.stats(req.auth, q);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(req.auth, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.tickets.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.tickets.update(req.auth, actorFrom(req), id, body);
  }

  @Post(':id/comments')
  comment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>,
  ) {
    return this.tickets.comment(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.remove(req.auth, actorFrom(req), id);
  }
}

@Module({ controllers: [TicketsController], providers: [TicketsService], exports: [TicketsService] })
export class TicketsModule {}

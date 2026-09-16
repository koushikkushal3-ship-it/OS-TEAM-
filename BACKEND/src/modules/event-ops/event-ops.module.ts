import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { budgetPercent } from '../automation/rules.js';
import { PermissionService } from '../permissions/permission.service.js';
import { notify, recycle } from '../platform/records.js';

const person = { select: { id: true, name: true, avatarUrl: true } } as const;
const OPEN_TASKS = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;
const DAY = 86_400_000;

const shiftBody = z
  .object({
    title: z.string().trim().min(2).max(120),
    location: z.string().trim().max(200).nullish(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    capacity: z.coerce.number().int().min(1).max(500).default(1),
    notes: z.string().trim().max(1000).nullish(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: 'A shift must end after it starts', path: ['endsAt'] });

const runBody = z.object({
  title: z.string().trim().min(2).max(200),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  ownerId: z.string().uuid().nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const duplicateBody = z.object({
  name: z.string().trim().min(2).max(160),
  startDate: z.coerce.date().nullish(),
  copyTasks: z.boolean().default(true),
  copyBudgets: z.boolean().default(true),
  copyShifts: z.boolean().default(true),
  copyRunOfShow: z.boolean().default(true),
});

const shiftInclude = { assignments: { include: { user: person }, orderBy: { createdAt: 'asc' } } } as const;

/** Day-of-event operations: shifts, run of show, templates, budget health, workload. */
@Controller()
export class EventOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  private async event(req: AuthenticatedRequest, id: string) {
    return this.prisma.event.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
  }

  // ── shifts ─────────────────────────────────────────────────────

  @Get('events/:id/shifts')
  @RequirePermission('shift.view', { eventParam: 'id' })
  async shifts(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.event(req, id);
    const [shifts, canManage, canSignup] = await Promise.all([
      this.prisma.shift.findMany({ where: { eventId: id }, orderBy: { startsAt: 'asc' }, include: shiftInclude }),
      this.permissions.can(req.auth, 'shift.manage', { eventId: id }),
      this.permissions.can(req.auth, 'shift.signup', { eventId: id }),
    ]);
    return { shifts, capabilities: { canManage, canSignup } };
  }

  /** Shifts across all events for the "My shifts" page: mine, plus open ones I could take. */
  @Get('shifts/upcoming')
  @RequirePermission('shift.view')
  upcoming(@Req() req: AuthenticatedRequest) {
    return this.prisma.shift.findMany({
      where: { organizationId: req.user.organizationId, endsAt: { gte: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 200,
      include: { ...shiftInclude, event: { select: { id: true, name: true } } },
    });
  }

  @Post('events/:id/shifts')
  @RequirePermission('shift.manage', { eventParam: 'id' })
  async createShift(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(shiftBody)) body: z.infer<typeof shiftBody>) {
    await this.event(req, id);
    const shift = await this.prisma.shift.create({ data: { ...body, eventId: id, organizationId: req.user.organizationId }, include: shiftInclude });
    await this.audit.record(actorFrom(req), { action: 'shift.created', entityType: 'shift', entityId: shift.id, newValue: body });
    return shift;
  }

  private async shift(req: AuthenticatedRequest, id: string, action: string) {
    const shift = await this.prisma.shift.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId }, include: shiftInclude });
    await this.permissions.assert(req.auth, action, { eventId: shift.eventId });
    return shift;
  }

  @Patch('shifts/:id')
  async updateShift(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(shiftBody)) body: z.infer<typeof shiftBody>) {
    const before = await this.shift(req, id, 'shift.manage');
    const shift = await this.prisma.shift.update({ where: { id }, data: body, include: shiftInclude });
    await this.audit.record(actorFrom(req), { action: 'shift.updated', entityType: 'shift', entityId: id, oldValue: { title: before.title, startsAt: before.startsAt }, newValue: body });
    return shift;
  }

  @Delete('shifts/:id')
  @HttpCode(204)
  async deleteShift(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.shift(req, id, 'shift.manage');
    const { assignments, ...row } = before;
    await recycle(this.prisma, {
      organizationId: req.user.organizationId,
      entityType: 'shift',
      row,
      label: before.title,
      deletedById: req.user.id,
      children: [{ model: 'shiftAssignment', rows: assignments.map(({ user: _user, ...a }) => a) }],
    });
    await this.prisma.shift.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'shift.deleted', entityType: 'shift', entityId: id, oldValue: { title: before.title, people: before.assignments.length } });
  }

  private async assign(req: AuthenticatedRequest, shiftId: string, userId: string, self: boolean) {
    const shift = await this.shift(req, shiftId, self ? 'shift.signup' : 'shift.manage');
    if (shift.assignments.some((a) => a.userId === userId)) return shift;
    if (shift.assignments.length >= shift.capacity) throw new BadRequestException('This shift is already full');
    await this.prisma.user.findFirstOrThrow({ where: { id: userId, organizationId: req.user.organizationId, status: { not: 'DISABLED' } } });

    // Two shifts at the same time for one person is almost always a mistake.
    const clash = await this.prisma.shiftAssignment.findFirst({
      where: { userId, shift: { id: { not: shiftId }, startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } } },
      include: { shift: { select: { title: true } } },
    });
    if (clash) throw new BadRequestException(`Overlaps with another shift: ${clash.shift.title}`);

    await this.prisma.shiftAssignment.create({ data: { shiftId, userId } });
    await this.audit.record(actorFrom(req), { action: self ? 'shift.signed_up' : 'shift.assigned', entityType: 'shift', entityId: shiftId, newValue: { userId } });
    if (!self) {
      await notify(this.prisma, {
        organizationId: req.user.organizationId,
        userIds: [userId],
        exceptUserId: req.user.id,
        type: 'shift.assigned',
        title: `You are on shift: ${shift.title}`,
        body: shift.startsAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
        link: `/events/${shift.eventId}`,
      });
    }
    return this.prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: shiftInclude });
  }

  @Post('shifts/:id/signup')
  signup(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.assign(req, id, req.user.id, true);
  }

  @Delete('shifts/:id/signup')
  @HttpCode(204)
  async leave(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.shift(req, id, 'shift.view');
    await this.prisma.shiftAssignment.deleteMany({ where: { shiftId: id, userId: req.user.id } });
    await this.audit.record(actorFrom(req), { action: 'shift.left', entityType: 'shift', entityId: id });
  }

  @Post('shifts/:id/assign')
  assignPerson(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ userId: z.string().uuid() }))) body: { userId: string }) {
    return this.assign(req, id, body.userId, false);
  }

  @Delete('shifts/:id/assign/:userId')
  @HttpCode(204)
  async unassign(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.shift(req, id, 'shift.manage');
    await this.prisma.shiftAssignment.deleteMany({ where: { shiftId: id, userId } });
    await this.audit.record(actorFrom(req), { action: 'shift.unassigned', entityType: 'shift', entityId: id, oldValue: { userId } });
  }

  // ── run of show ────────────────────────────────────────────────

  @Get('events/:id/run')
  @RequirePermission('event.view', { eventParam: 'id' })
  async run(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.event(req, id);
    const [items, canManage] = await Promise.all([
      this.prisma.runItem.findMany({ where: { eventId: id }, orderBy: { startsAt: 'asc' }, include: { owner: person } }),
      this.permissions.can(req.auth, 'event.update', { eventId: id }),
    ]);
    return { items, capabilities: { canManage } };
  }

  @Post('events/:id/run')
  @RequirePermission('event.update', { eventParam: 'id' })
  async addRun(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(runBody)) body: z.infer<typeof runBody>) {
    await this.event(req, id);
    const item = await this.prisma.runItem.create({ data: { ...body, eventId: id, organizationId: req.user.organizationId }, include: { owner: person } });
    await this.audit.record(actorFrom(req), { action: 'run_item.created', entityType: 'run_item', entityId: item.id, newValue: body });
    if (body.ownerId) {
      await notify(this.prisma, { organizationId: req.user.organizationId, userIds: [body.ownerId], exceptUserId: req.user.id, type: 'run.assigned', title: `Run of show: ${body.title}`, link: `/events/${id}` });
    }
    return item;
  }

  /** The owner can tick their own line off on the day; anything else needs event.update. */
  @Patch('run-items/:id')
  async updateRun(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(runBody.partial().extend({ done: z.boolean().optional() }))) body: Partial<z.infer<typeof runBody>> & { done?: boolean },
  ) {
    const before = await this.prisma.runItem.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const { done, ...fields } = body;
    const onlyTicking = Object.keys(fields).length === 0 && done !== undefined;
    if (!(onlyTicking && before.ownerId === req.user.id)) await this.permissions.assert(req.auth, 'event.update', { eventId: before.eventId });
    const item = await this.prisma.runItem.update({
      where: { id },
      data: { ...fields, ...(done !== undefined && { doneAt: done ? new Date() : null }) },
      include: { owner: person },
    });
    await this.audit.record(actorFrom(req), { action: 'run_item.updated', entityType: 'run_item', entityId: id, oldValue: { done: !!before.doneAt }, newValue: body });
    return item;
  }

  @Delete('run-items/:id')
  @HttpCode(204)
  async deleteRun(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.runItem.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.permissions.assert(req.auth, 'event.update', { eventId: before.eventId });
    await recycle(this.prisma, { organizationId: req.user.organizationId, entityType: 'run_item', row: before, label: before.title, deletedById: req.user.id });
    await this.prisma.runItem.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'run_item.deleted', entityType: 'run_item', entityId: id, oldValue: { title: before.title } });
  }

  // ── event templates ────────────────────────────────────────────

  /**
   * Copies an event as a starting point: teams, tasks (reset to backlog, unassigned, dates
   * shifted), budgets, shifts and run of show. Money spent and attendance are never copied.
   */
  @Post('events/:id/duplicate')
  @RequirePermission('event.create')
  async duplicate(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(duplicateBody)) body: z.infer<typeof duplicateBody>) {
    const source = await this.prisma.event.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: { teams: true, tasks: true, budgets: true, shifts: true, runItems: true },
    });
    const offset = body.startDate && source.startDate ? body.startDate.getTime() - source.startDate.getTime() : 0;
    const move = (d: Date | null) => (d ? new Date(d.getTime() + offset) : null);
    const orgId = req.user.organizationId;

    const created = await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          organizationId: orgId,
          ownerId: req.user.id,
          name: body.name,
          description: source.description,
          venue: source.venue,
          startDate: body.startDate ?? source.startDate,
          endDate: move(source.endDate),
          budget: source.budget,
          status: 'PLANNING',
          teams: { create: source.teams.map((t) => ({ teamId: t.teamId })) },
        },
      });

      if (body.copyTasks) {
        // Parents first so subtasks can point at their copies.
        const idMap = new Map<string, string>();
        const ordered = [...source.tasks].sort((a, b) => Number(!!a.parentTaskId) - Number(!!b.parentTaskId));
        for (const t of ordered) {
          const copy = await tx.task.create({
            data: {
              organizationId: orgId,
              eventId: event.id,
              teamId: t.teamId,
              parentTaskId: t.parentTaskId ? (idMap.get(t.parentTaskId) ?? null) : null,
              title: t.title,
              description: t.description,
              priority: t.priority,
              status: 'BACKLOG',
              startDate: move(t.startDate),
              dueDate: move(t.dueDate),
              createdById: req.user.id,
            },
          });
          idMap.set(t.id, copy.id);
        }
      }
      if (body.copyBudgets && source.budgets.length) {
        await tx.budget.createMany({ data: source.budgets.map((b) => ({ organizationId: orgId, eventId: event.id, teamId: b.teamId, name: b.name, amount: b.amount, notes: b.notes, createdById: req.user.id })) });
      }
      if (body.copyShifts && source.shifts.length) {
        await tx.shift.createMany({ data: source.shifts.map((s) => ({ organizationId: orgId, eventId: event.id, title: s.title, location: s.location, startsAt: move(s.startsAt)!, endsAt: move(s.endsAt)!, capacity: s.capacity, notes: s.notes })) });
      }
      if (body.copyRunOfShow && source.runItems.length) {
        await tx.runItem.createMany({ data: source.runItems.map((r) => ({ organizationId: orgId, eventId: event.id, title: r.title, startsAt: move(r.startsAt)!, endsAt: move(r.endsAt), ownerId: r.ownerId, notes: r.notes })) });
      }
      return event;
    });

    await this.audit.record(actorFrom(req), {
      action: 'event.duplicated',
      entityType: 'event',
      entityId: created.id,
      newValue: { from: source.name, name: body.name, tasks: body.copyTasks ? source.tasks.length : 0, budgets: body.copyBudgets ? source.budgets.length : 0, shiftedDays: Math.round(offset / DAY) },
    });
    return created;
  }

  // ── budget health ──────────────────────────────────────────────

  @Get('finance/budget-health')
  @RequirePermission('finance.view')
  async budgetHealth(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ eventId: z.string().uuid().optional() }))) q: { eventId?: string }) {
    const budgets = await this.prisma.budget.findMany({
      where: { organizationId: req.user.organizationId, ...(q.eventId && { eventId: q.eventId }) },
      include: { event: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const spent = await this.prisma.expense.groupBy({
      by: ['budgetId'],
      where: { budgetId: { in: budgets.map((b) => b.id) }, status: { in: ['APPROVED', 'REIMBURSED'] } },
      _sum: { amount: true },
    });
    const pending = await this.prisma.expense.groupBy({
      by: ['budgetId'],
      where: { budgetId: { in: budgets.map((b) => b.id) }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      _sum: { amount: true },
    });
    const sum = (rows: typeof spent, id: string) => Number(rows.find((r) => r.budgetId === id)?._sum.amount ?? 0);
    return budgets.map((b) => {
      const used = sum(spent, b.id);
      const percent = budgetPercent(used, Number(b.amount));
      return {
        id: b.id,
        name: b.name,
        event: b.event,
        team: b.team,
        amount: Number(b.amount),
        spent: used,
        pending: sum(pending, b.id),
        percent,
        state: percent >= 100 ? 'over' : percent >= 80 ? 'warning' : 'ok',
      };
    });
  }

  // ── workload ───────────────────────────────────────────────────

  /** Who is carrying how much, before a lead assigns more. */
  @Get('workload')
  @RequirePermission('task.assign')
  async workload(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(z.object({ teamId: z.string().uuid().optional() }))) q: { teamId?: string }) {
    const orgId = req.user.organizationId;
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * DAY);
    const people = await this.prisma.user.findMany({
      where: { organizationId: orgId, status: 'ACTIVE', ...(q.teamId && { teamMemberships: { some: { teamId: q.teamId } } }) },
      select: { id: true, name: true, avatarUrl: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 300,
    });
    const ids = people.map((p) => p.id);
    const [open, overdue, dueSoon, tickets, onLeave, shifts] = await Promise.all([
      this.prisma.task.groupBy({ by: ['assignedToId'], where: { assignedToId: { in: ids }, status: { in: [...OPEN_TASKS] } }, _count: true }),
      this.prisma.task.groupBy({ by: ['assignedToId'], where: { assignedToId: { in: ids }, status: { in: [...OPEN_TASKS] }, dueDate: { lt: now } }, _count: true }),
      this.prisma.task.groupBy({ by: ['assignedToId'], where: { assignedToId: { in: ids }, status: { in: [...OPEN_TASKS] }, dueDate: { gte: now, lte: weekEnd } }, _count: true }),
      this.prisma.ticket.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: { notIn: ['RESOLVED', 'CLOSED'] } }, _count: true }),
      this.prisma.leaveRequest.findMany({ where: { userId: { in: ids }, status: 'APPROVED', startDate: { lte: weekEnd }, endDate: { gte: now } }, select: { userId: true, startDate: true, endDate: true, type: true } }),
      this.prisma.shiftAssignment.groupBy({ by: ['userId'], where: { userId: { in: ids }, shift: { startsAt: { gte: now, lte: weekEnd } } }, _count: true }),
    ]);
    const count = <K extends string>(rows: ({ _count: number } & Record<K, string | null>)[], key: K, id: string) => rows.find((r) => r[key] === id)?._count ?? 0;

    return people
      .map((p) => {
        const leave = onLeave.find((l) => l.userId === p.id) ?? null;
        const row = {
          person: p,
          openTasks: count(open, 'assignedToId', p.id),
          overdue: count(overdue, 'assignedToId', p.id),
          dueThisWeek: count(dueSoon, 'assignedToId', p.id),
          openTickets: count(tickets, 'assigneeId', p.id),
          shiftsThisWeek: count(shifts, 'userId', p.id),
          leave,
        };
        // Simple, visible load measure: open work plus extra weight for what is already late.
        const load = row.openTasks + row.openTickets + row.overdue;
        return { ...row, load, state: leave && leave.startDate <= now ? 'away' : load >= 12 ? 'heavy' : load >= 6 ? 'busy' : 'light' };
      })
      .sort((a, b) => b.load - a.load);
  }
}

@Module({ controllers: [EventOpsController] })
export class EventOpsModule {}


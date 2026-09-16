import { Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import type { AuthenticatedRequest } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { type ScoreWeights, computeScore, readWeights } from './performance.js';

/** A task carrying an update in the last week counts as actively reported on. */
const RECENT_UPDATE_DAYS = 7;

const OPEN_TASKS = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  private async weights(): Promise<ScoreWeights> {
    const reportsModule = await this.prisma.module.findUnique({ where: { key: 'reports' } });
    return readWeights(reportsModule?.config);
  }

  /** Task, meeting and update counts for one scope, ready for scoring. */
  private async signals(organizationId: string, scope: { teamId?: string; eventId?: string; userId?: string }) {
    const taskWhere = {
      organizationId,
      ...(scope.teamId && { teamId: scope.teamId }),
      ...(scope.eventId && { eventId: scope.eventId }),
      ...(scope.userId && { assignedToId: scope.userId }),
    };
    const since = new Date(Date.now() - RECENT_UPDATE_DAYS * 86_400_000);

    const [total, completed, onTime, active, withUpdate, meetings] = await Promise.all([
      this.prisma.task.count({ where: taskWhere }),
      this.prisma.task.count({ where: { ...taskWhere, status: 'COMPLETED' } }),
      // Completed before the due date, or with no due date to miss.
      this.prisma.task.count({
        where: {
          ...taskWhere,
          status: 'COMPLETED',
          OR: [{ dueDate: null }, { completedAt: { lte: this.prisma.task.fields.dueDate } }],
        },
      }),
      this.prisma.task.count({ where: { ...taskWhere, status: { in: [...OPEN_TASKS] } } }),
      this.prisma.task.count({
        where: { ...taskWhere, status: { in: [...OPEN_TASKS] }, updates: { some: { createdAt: { gte: since } } } },
      }),
      this.prisma.meetingParticipant.findMany({
        where: {
          meeting: {
            organizationId,
            status: 'ENDED',
            ...(scope.teamId && { teamId: scope.teamId }),
            ...(scope.eventId && { eventId: scope.eventId }),
          },
          ...(scope.userId && { userId: scope.userId }),
        },
        select: { status: true },
      }),
    ]);

    const attended = meetings.filter((m) => ['PRESENT', 'LATE', 'PARTIAL', 'EXCUSED'].includes(m.status)).length;
    return {
      tasksTotal: total,
      tasksCompleted: completed,
      tasksOnTime: onTime,
      tasksActive: active,
      tasksWithRecentUpdate: withUpdate,
      meetingsTotal: meetings.length,
      meetingsAttended: attended,
    };
  }

  /** Executive view of the whole organization (Master Plan §14). */
  async organization(auth: AuthContext) {
    const organizationId = auth.organizationId;
    const weights = await this.weights();

    const [signals, people, teams, events, tickets, ideas, opportunities, finance] = await Promise.all([
      this.signals(organizationId, {}),
      this.prisma.user.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
      this.prisma.team.count({ where: { organizationId, isActive: true } }),
      this.prisma.event.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
      this.prisma.ticket.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
      this.prisma.idea.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
      this.prisma.opportunity.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
      this.financeTotals(auth, {}),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      performance: computeScore(signals, weights),
      work: signals,
      people: Object.fromEntries(people.map((p) => [p.status, p._count])),
      teams,
      events: Object.fromEntries(events.map((e) => [e.status, e._count])),
      tickets: Object.fromEntries(tickets.map((t) => [t.status, t._count])),
      ideas: Object.fromEntries(ideas.map((i) => [i.status, i._count])),
      opportunities: Object.fromEntries(opportunities.map((o) => [o.status, o._count])),
      finance,
    };
  }

  /** Team-by-team performance table (Master Plan §14 example). */
  async performance(auth: AuthContext, q: { eventId?: string }) {
    const weights = await this.weights();
    const teams = await this.prisma.team.findMany({
      where: { organizationId: auth.organizationId, isActive: true },
      select: {
        id: true,
        name: true,
        _count: { select: { members: true } },
        members: {
          where: { memberRole: { in: ['LEAD', 'CO_LEAD'] } },
          select: { memberRole: true, user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const rows = [];
    for (const team of teams) {
      const signals = await this.signals(auth.organizationId, { teamId: team.id, eventId: q.eventId });
      rows.push({
        team: { id: team.id, name: team.name },
        members: team._count.members,
        leads: team.members.map((m) => ({ ...m.user, memberRole: m.memberRole })),
        ...computeScore(signals, weights),
        work: signals,
      });
    }
    // Strongest first, teams with no data last.
    return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  /** How each person is doing on their own work (leads and above). */
  async people(auth: AuthContext, q: { teamId?: string; eventId?: string }) {
    const weights = await this.weights();
    const members = await this.prisma.user.findMany({
      where: {
        organizationId: auth.organizationId,
        status: 'ACTIVE',
        ...(q.teamId && { teamMemberships: { some: { teamId: q.teamId } } }),
      },
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
      take: 100,
    });

    const rows = [];
    for (const person of members) {
      const signals = await this.signals(auth.organizationId, { userId: person.id, eventId: q.eventId, teamId: q.teamId });
      if (signals.tasksTotal === 0 && signals.meetingsTotal === 0) continue;
      rows.push({ person, ...computeScore(signals, weights), work: signals });
    }
    return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  /** A person's own score — the same explanation leads see, so nothing is hidden from them. */
  async me(auth: AuthContext) {
    const [weights, signals] = await Promise.all([this.weights(), this.signals(auth.organizationId, { userId: auth.userId })]);
    return { ...computeScore(signals, weights), work: signals, weights };
  }

  /** The full event report from the Master Plan (§63). */
  async event(auth: AuthContext, id: string) {
    const event = await this.prisma.event.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        venue: true,
        owner: { select: { id: true, name: true } },
        teams: { select: { team: { select: { id: true, name: true, _count: { select: { members: true } } } } } },
        _count: { select: { members: true } },
      },
    });

    const weights = await this.weights();
    const [signals, meetings, tickets, opportunities, ideas, finance, teamRows] = await Promise.all([
      this.signals(auth.organizationId, { eventId: id }),
      this.prisma.meeting.groupBy({ by: ['status'], where: { organizationId: auth.organizationId, eventId: id }, _count: true }),
      this.prisma.ticket.groupBy({ by: ['status'], where: { organizationId: auth.organizationId, eventId: id }, _count: true }),
      this.prisma.opportunity.groupBy({ by: ['type', 'status'], where: { organizationId: auth.organizationId, eventId: id }, _count: true }),
      this.prisma.idea.count({ where: { organizationId: auth.organizationId, eventId: id } }),
      this.financeTotals(auth, { eventId: id }),
      this.performance(auth, { eventId: id }),
    ]);

    const eventTeamIds = new Set(event.teams.map((t) => t.team.id));
    return {
      generatedAt: new Date().toISOString(),
      event,
      performance: computeScore(signals, weights),
      work: signals,
      teams: teamRows.filter((row) => eventTeamIds.has(row.team.id)),
      meetings: Object.fromEntries(meetings.map((m) => [m.status, m._count])),
      tickets: Object.fromEntries(tickets.map((t) => [t.status, t._count])),
      opportunities: opportunities.map((o) => ({ type: o.type, status: o.status, count: o._count })),
      ideas,
      finance,
    };
  }

  /** Finance figures, but only for people allowed to see money. */
  private async financeTotals(auth: AuthContext, scope: { eventId?: string }) {
    if (!(await this.permissions.can(auth, 'finance.view', { eventId: scope.eventId }))) return null;

    const where = { organizationId: auth.organizationId, eventId: scope.eventId };
    const [budget, expenses] = await Promise.all([
      this.prisma.budget.aggregate({ where, _sum: { amount: true } }),
      this.prisma.expense.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: true }),
    ]);

    const sum = (statuses: string[]) =>
      expenses.filter((e) => statuses.includes(e.status)).reduce((total, e) => total + Number(e._sum.amount ?? 0), 0);

    const allocated = Number(budget._sum.amount ?? 0);
    const spent = sum(['APPROVED', 'REIMBURSED']);
    return {
      allocated,
      spent,
      pending: sum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW']),
      remaining: allocated - spent,
      byStatus: Object.fromEntries(expenses.map((e) => [e.status, { count: e._count, amount: Number(e._sum.amount ?? 0) }])),
    };
  }

  /** What happened in a period — the daily / weekly report (Master Plan §14). */
  async activity(auth: AuthContext, q: z.infer<typeof rangeSchema>) {
    const from = q.from ?? new Date(Date.now() - 7 * 86_400_000);
    const to = q.to ?? new Date();
    const range = { gte: from, lte: to };
    const organizationId = auth.organizationId;

    const [tasksCreated, tasksCompleted, updates, meetingsHeld, expensesSubmitted, ticketsOpened, ticketsResolved, ideasSubmitted] =
      await Promise.all([
        this.prisma.task.count({ where: { organizationId, createdAt: range } }),
        this.prisma.task.count({ where: { organizationId, completedAt: range } }),
        this.prisma.taskUpdate.count({ where: { task: { organizationId }, createdAt: range } }),
        this.prisma.meeting.count({ where: { organizationId, status: 'ENDED', endedAt: range } }),
        this.prisma.expense.count({ where: { organizationId, createdAt: range } }),
        this.prisma.ticket.count({ where: { organizationId, createdAt: range } }),
        this.prisma.ticket.count({ where: { organizationId, resolvedAt: range } }),
        this.prisma.idea.count({ where: { organizationId, createdAt: range } }),
      ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      tasksCreated,
      tasksCompleted,
      workUpdates: updates,
      meetingsHeld,
      expensesSubmitted,
      ticketsOpened,
      ticketsResolved,
      ideasSubmitted,
    };
  }
}

/** Reports are read-only views of work already recorded — never a separate source of truth. */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.reports.me(req.auth);
  }

  @Get('organization')
  @RequirePermission('report.view')
  organization(@Req() req: AuthenticatedRequest) {
    return this.reports.organization(req.auth);
  }

  @Get('performance')
  @RequirePermission('report.view')
  performance(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodPipe(z.object({ eventId: z.string().uuid().optional() }))) q: { eventId?: string },
  ) {
    return this.reports.performance(req.auth, q);
  }

  @Get('people')
  @RequirePermission('report.view')
  people(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodPipe(z.object({ teamId: z.string().uuid().optional(), eventId: z.string().uuid().optional() })))
    q: { teamId?: string; eventId?: string },
  ) {
    return this.reports.people(req.auth, q);
  }

  @Get('activity')
  @RequirePermission('report.view')
  activity(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.reports.activity(req.auth, q);
  }

  @Get('event/:id')
  @RequirePermission('report.view', { eventParam: 'id' })
  event(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.event(req.auth, id);
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}

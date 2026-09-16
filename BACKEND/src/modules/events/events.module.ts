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
  Put,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { recycle } from '../platform/records.js';

const eventBody = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).nullish(),
    venue: z.string().trim().max(200).nullish(),
    startDate: z.coerce.date().nullish(),
    endDate: z.coerce.date().nullish(),
    budget: z.number().nonnegative().nullish(),
    ownerId: z.string().uuid().nullish(),
    status: z.enum(['PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED']).optional(),
  });
const createEvent = eventBody.extend({ teamIds: z.array(z.string().uuid()).default([]) });
const teamsBody = z.object({ teamIds: z.array(z.string().uuid()) });
const memberBody = z.object({ role: z.string().trim().max(80).nullish() });

@Controller('events')
export class EventsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  /** Events the user can see: permission-filtered, plus events they or their teams work on. */
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const events = await this.prisma.event.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ startDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      include: {
        owner: { select: { id: true, name: true } },
        teams: { include: { team: { select: { id: true, name: true } } } },
        _count: { select: { members: true } },
      },
    });
    const visible = [];
    for (const event of events) {
      if (await this.canView(req, event.id, event.teams.map((t) => t.teamId))) {
        visible.push(await this.withBudgetVisibility(req, event));
      }
    }
    return visible;
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const event = await this.prisma.event.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        teams: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
                members: {
                  where: { memberRole: { in: ['LEAD', 'CO_LEAD'] } },
                  select: { memberRole: true, user: { select: { id: true, name: true } } },
                },
                _count: { select: { members: true } },
              },
            },
          },
        },
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
      },
    });
    if (!(await this.canView(req, id, event.teams.map((t) => t.teamId)))) {
      await this.permissions.assert(req.auth, 'event.view', { eventId: id });
    }
    const [canUpdate, canManageTeams, canDelete] = await Promise.all([
      this.permissions.can(req.auth, 'event.update', { eventId: id }),
      this.permissions.can(req.auth, 'event.manage_teams', { eventId: id }),
      this.permissions.can(req.auth, 'event.delete', { eventId: id }),
    ]);
    return { ...(await this.withBudgetVisibility(req, event)), capabilities: { canUpdate, canManageTeams, canDelete } };
  }

  /** Creating an event provisions workspaces for the selected teams (Master Plan §6). */
  @Post()
  @RequirePermission('event.create')
  async create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createEvent)) body: z.infer<typeof createEvent>) {
    const { teamIds, ...fields } = body;
    this.assertDates(fields.startDate, fields.endDate);
    await this.assertTeams(req, teamIds);
    const event = await this.prisma.event.create({
      data: {
        ...fields,
        ownerId: fields.ownerId ?? req.user.id,
        organizationId: req.user.organizationId,
        teams: { create: [...new Set(teamIds)].map((teamId) => ({ teamId })) },
      },
    });
    await this.audit.record(actorFrom(req), { action: 'event.created', entityType: 'event', entityId: event.id, newValue: body });
    return event;
  }

  @Patch(':id')
  @RequirePermission('event.update', { eventParam: 'id' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(eventBody.partial())) body: Partial<z.infer<typeof eventBody>>,
  ) {
    const before = await this.prisma.event.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    this.assertDates(body.startDate ?? before.startDate, body.endDate ?? before.endDate);
    const event = await this.prisma.event.update({ where: { id }, data: body });
    await this.audit.record(actorFrom(req), {
      action: 'event.updated',
      entityType: 'event',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(body).map((k) => [k, before[k as keyof typeof before]])),
      newValue: body,
    });
    return event;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('event.delete', { eventParam: 'id' })
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.event.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const shifts = await this.prisma.shift.findMany({ where: { eventId: id } });
    await recycle(this.prisma, {
      organizationId: req.user.organizationId,
      entityType: 'event',
      row: before,
      label: before.name,
      deletedById: req.user.id,
      children: [
        { model: 'eventTeam', rows: await this.prisma.eventTeam.findMany({ where: { eventId: id } }) },
        { model: 'eventMember', rows: await this.prisma.eventMember.findMany({ where: { eventId: id } }) },
        { model: 'budget', rows: await this.prisma.budget.findMany({ where: { eventId: id } }) },
        { model: 'shift', rows: shifts },
        { model: 'shiftAssignment', rows: await this.prisma.shiftAssignment.findMany({ where: { shiftId: { in: shifts.map((s) => s.id) } } }) },
        { model: 'runItem', rows: await this.prisma.runItem.findMany({ where: { eventId: id } }) },
      ],
    });
    await this.prisma.event.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'event.deleted', entityType: 'event', entityId: id, oldValue: { name: before.name } });
  }

  @Put(':id/teams')
  @RequirePermission('event.manage_teams', { eventParam: 'id' })
  async setTeams(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(teamsBody)) body: z.infer<typeof teamsBody>,
  ) {
    const event = await this.prisma.event.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: { teams: { select: { teamId: true } } },
    });
    const next = [...new Set(body.teamIds)];
    await this.assertTeams(req, next);
    const current = event.teams.map((t) => t.teamId);
    const added = next.filter((t) => !current.includes(t));
    const removed = current.filter((t) => !next.includes(t));

    await this.prisma.$transaction([
      this.prisma.eventTeam.deleteMany({ where: { eventId: id, teamId: { in: removed } } }),
      this.prisma.eventTeam.createMany({ data: added.map((teamId) => ({ eventId: id, teamId })) }),
    ]);
    await this.audit.record(actorFrom(req), {
      action: 'event.teams_changed',
      entityType: 'event',
      entityId: id,
      oldValue: { teamIds: current },
      newValue: { teamIds: next, added, removed },
    });
    return { eventId: id, teamIds: next };
  }

  @Put(':id/members/:userId')
  @RequirePermission('event.manage_teams', { eventParam: 'id' })
  async setMember(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(memberBody)) body: z.infer<typeof memberBody>,
  ) {
    await this.prisma.event.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.prisma.user.findFirstOrThrow({ where: { id: userId, organizationId: req.user.organizationId } });
    const member = await this.prisma.eventMember.upsert({
      where: { eventId_userId: { eventId: id, userId } },
      create: { eventId: id, userId, role: body.role },
      update: { role: body.role },
    });
    await this.audit.record(actorFrom(req), { action: 'event.member_set', entityType: 'event', entityId: id, newValue: { userId, role: body.role } });
    return member;
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission('event.manage_teams', { eventParam: 'id' })
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.prisma.event.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.prisma.eventMember.delete({ where: { eventId_userId: { eventId: id, userId } } });
    await this.audit.record(actorFrom(req), { action: 'event.member_removed', entityType: 'event', entityId: id, oldValue: { userId } });
  }

  private async canView(req: AuthenticatedRequest, eventId: string, teamIds: string[]) {
    if (req.auth.eventIds.includes(eventId)) return true;
    if (teamIds.some((t) => req.auth.teamIds.includes(t))) return true;
    return this.permissions.can(req.auth, 'event.view', { eventId });
  }

  /** Budget is financial data: shown only to people who can edit the event or view finance. */
  private async withBudgetVisibility<T extends { id: string; budget: unknown }>(req: AuthenticatedRequest, event: T) {
    const allowed =
      (await this.permissions.can(req.auth, 'event.update', { eventId: event.id })) ||
      (await this.permissions.can(req.auth, 'finance.view', { eventId: event.id }));
    return allowed ? event : { ...event, budget: null };
  }

  private assertDates(start?: Date | null, end?: Date | null) {
    if (start && end && end < start) throw new BadRequestException('End date must be after the start date');
  }

  private async assertTeams(req: AuthenticatedRequest, teamIds: string[]) {
    if (teamIds.length === 0) return;
    const unique = [...new Set(teamIds)];
    const n = await this.prisma.team.count({ where: { id: { in: unique }, organizationId: req.user.organizationId } });
    if (n !== unique.length) throw new BadRequestException('One or more teams were not found');
  }
}

@Module({ controllers: [EventsController] })
export class EventsModule {}

import {
  Body,
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

const teamBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).nullish(),
  departmentId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});
const createTeam = teamBody.extend({ leadUserId: z.string().uuid().optional() });
const memberBody = z.object({ memberRole: z.enum(['LEAD', 'CO_LEAD', 'MEMBER']).default('MEMBER') });

const memberSelect = {
  memberRole: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true, status: true } },
} as const;

@Controller('teams')
export class TeamsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  /** Teams the user can see: permission-filtered, plus every team they belong to. */
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const teams = await this.prisma.team.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { name: 'asc' },
      include: {
        department: { select: { id: true, name: true } },
        members: { where: { memberRole: { in: ['LEAD', 'CO_LEAD'] } }, select: memberSelect },
        _count: { select: { members: true, events: true } },
      },
    });
    const visible = [];
    for (const team of teams) {
      if (req.auth.teamIds.includes(team.id) || (await this.permissions.can(req.auth, 'team.view', { teamId: team.id }))) {
        visible.push({ ...team, isMember: req.auth.teamIds.includes(team.id) });
      }
    }
    return visible;
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertCanView(req, id);
    const team = await this.prisma.team.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: {
        department: { select: { id: true, name: true } },
        members: { select: memberSelect, orderBy: [{ memberRole: 'asc' }, { joinedAt: 'asc' }] },
        events: { include: { event: { select: { id: true, name: true, status: true, startDate: true, endDate: true } } } },
      },
    });
    const [canUpdate, canManageMembers, canRemove] = await Promise.all([
      this.permissions.can(req.auth, 'team.update', { teamId: id }),
      this.permissions.can(req.auth, 'team.manage_members', { teamId: id }),
      this.permissions.can(req.auth, 'team.remove', { teamId: id }),
    ]);
    return { ...team, capabilities: { canUpdate, canManageMembers, canRemove } };
  }

  @Post()
  @RequirePermission('team.create')
  async create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createTeam)) body: z.infer<typeof createTeam>) {
    const { leadUserId, ...fields } = body;
    if (leadUserId) await this.assertUserInOrg(req, leadUserId);
    const team = await this.prisma.team.create({
      data: {
        ...fields,
        organizationId: req.user.organizationId,
        ...(leadUserId && { members: { create: { userId: leadUserId, memberRole: 'LEAD' } } }),
      },
    });
    await this.audit.record(actorFrom(req), { action: 'team.created', entityType: 'team', entityId: team.id, newValue: body });
    return team;
  }

  @Patch(':id')
  @RequirePermission('team.update', { teamParam: 'id' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(teamBody.partial())) body: Partial<z.infer<typeof teamBody>>,
  ) {
    const before = await this.prisma.team.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const team = await this.prisma.team.update({ where: { id }, data: body });
    await this.audit.record(actorFrom(req), {
      action: 'team.updated',
      entityType: 'team',
      entityId: id,
      oldValue: { name: before.name, description: before.description, departmentId: before.departmentId, isActive: before.isActive },
      newValue: body,
    });
    return team;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('team.remove', { teamParam: 'id' })
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.team.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await recycle(this.prisma, {
      organizationId: req.user.organizationId,
      entityType: 'team',
      row: before,
      label: before.name,
      deletedById: req.user.id,
      children: [
        { model: 'teamMember', rows: await this.prisma.teamMember.findMany({ where: { teamId: id } }) },
        { model: 'eventTeam', rows: await this.prisma.eventTeam.findMany({ where: { teamId: id } }) },
      ],
    });
    await this.prisma.team.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'team.removed', entityType: 'team', entityId: id, oldValue: { name: before.name } });
  }

  /** Add a member or change their team role (lead / co-lead / member). */
  @Put(':id/members/:userId')
  @RequirePermission('team.manage_members', { teamParam: 'id' })
  async setMember(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(memberBody)) body: z.infer<typeof memberBody>,
  ) {
    await this.prisma.team.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.assertUserInOrg(req, userId);
    const before = await this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: id, userId } } });
    const member = await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: id, userId } },
      create: { teamId: id, userId, memberRole: body.memberRole },
      update: { memberRole: body.memberRole },
      select: memberSelect,
    });
    await this.audit.record(actorFrom(req), {
      action: before ? 'team.member_role_changed' : 'team.member_added',
      entityType: 'team',
      entityId: id,
      oldValue: before ? { userId, memberRole: before.memberRole } : null,
      newValue: { userId, memberRole: body.memberRole },
    });
    return member;
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @RequirePermission('team.manage_members', { teamParam: 'id' })
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.prisma.team.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const before = await this.prisma.teamMember.delete({ where: { teamId_userId: { teamId: id, userId } } });
    await this.audit.record(actorFrom(req), {
      action: 'team.member_removed',
      entityType: 'team',
      entityId: id,
      oldValue: { userId, memberRole: before.memberRole },
    });
  }

  private async assertCanView(req: AuthenticatedRequest, teamId: string) {
    if (req.auth.teamIds.includes(teamId)) return;
    await this.permissions.assert(req.auth, 'team.view', { teamId });
  }

  private async assertUserInOrg(req: AuthenticatedRequest, userId: string) {
    const n = await this.prisma.user.count({ where: { id: userId, organizationId: req.user.organizationId } });
    if (!n) throw new ForbiddenException('Person not found in this organization');
  }
}

@Module({ controllers: [TeamsController] })
export class TeamsModule {}

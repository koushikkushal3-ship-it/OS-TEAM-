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
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GatewaySettingsService } from './gateway-settings.service.js';
import { GatewayController } from './gateway.controller.js';
import { SecurityController } from './security.controller.js';
import { requestSecondApproval } from '../platform/records.js';

const organizationBody = z.object({ name: z.string().trim().min(2).max(120) });

const assignRoleBody = z
  .object({
    roleId: z.string().uuid(),
    scopeType: z.enum(['ORGANIZATION', 'DEPARTMENT', 'TEAM', 'EVENT']).default('ORGANIZATION'),
    scopeId: z.string().uuid().nullish(),
  })
  .refine((b) => (b.scopeType === 'ORGANIZATION') === !b.scopeId, {
    message: 'scopeId is required for department/team/event scopes and not allowed for organization scope',
  });

@MasterOnly()
@Controller('master')
export class MasterAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Master Admin dashboard (arch doc §14, §64). */
  @Get('overview')
  async overview(@Req() req: AuthenticatedRequest) {
    const organizationId = req.user.organizationId;
    const [users, activeUsers, teams, events, activeEvents, roles, modules, recentActivity] = await Promise.all([
      this.prisma.user.count({ where: { organizationId } }),
      this.prisma.user.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.team.count({ where: { organizationId, isActive: true } }),
      this.prisma.event.count({ where: { organizationId } }),
      this.prisma.event.count({ where: { organizationId, status: { in: ['PLANNING', 'ACTIVE'] } } }),
      this.prisma.role.count({ where: { organizationId } }),
      this.prisma.module.groupBy({ by: ['status'], _count: true }),
      this.prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: { actor: { select: { name: true } } },
      }),
    ]);
    return {
      totals: { users, activeUsers, teams, events, activeEvents, roles },
      modules: Object.fromEntries(modules.map((m) => [m.status, m._count])),
      recentActivity,
    };
  }

  @Get('organization')
  organization(@Req() req: AuthenticatedRequest) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } });
  }

  @Patch('organization')
  async updateOrganization(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(organizationBody)) body: z.infer<typeof organizationBody>) {
    const before = await this.prisma.organization.findUniqueOrThrow({ where: { id: req.user.organizationId } });
    const org = await this.prisma.organization.update({ where: { id: before.id }, data: body });
    await this.audit.record(actorFrom(req), { action: 'organization.updated', entityType: 'organization', entityId: org.id, oldValue: { name: before.name }, newValue: body });
    return org;
  }

  /** Role assignment is control-plane only — it is how administrators and leads are made. */
  @Post('users/:id/roles')
  async assignRole(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(assignRoleBody)) body: z.infer<typeof assignRoleBody>,
  ) {
    const orgId = req.user.organizationId;
    const [user, role] = await Promise.all([
      this.prisma.user.findFirstOrThrow({ where: { id: userId, organizationId: orgId } }),
      this.prisma.role.findFirstOrThrow({ where: { id: body.roleId, organizationId: orgId } }),
    ]);
    if (role.isMasterAdmin && body.scopeType !== 'ORGANIZATION') throw new BadRequestException('Master Admin can only be assigned organization-wide');
    if (body.scopeId) await this.assertScope(orgId, body.scopeType, body.scopeId);

    if (role.isMasterAdmin) {
      const pending = await requestSecondApproval(this.prisma, {
        organizationId: orgId,
        requestedById: req.user.id,
        kind: 'GRANT_MASTER_ADMIN',
        summary: `Make ${user.name} (${user.email}) a Master Admin`,
        payload: { userId, roleId: role.id },
      });
      if (pending) {
        await this.audit.record(actorFrom(req), { action: 'master.change_requested', entityType: 'change_request', entityId: pending.requestId, newValue: { kind: 'GRANT_MASTER_ADMIN', user: user.email } });
        return pending;
      }
    }

    const assignment = await this.prisma.userRole.create({
      data: { userId, roleId: role.id, scopeType: body.scopeType, scopeId: body.scopeId ?? null, assignedById: req.user.id },
    });
    await this.audit.record(actorFrom(req), {
      action: role.isMasterAdmin ? 'user.master_admin_granted' : 'user.role_assigned',
      entityType: 'user',
      entityId: userId,
      newValue: { user: user.email, role: role.name, scopeType: body.scopeType, scopeId: body.scopeId },
    });
    return assignment;
  }

  @Delete('users/:id/roles/:assignmentId')
  @HttpCode(204)
  async removeRole(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) userId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    const assignment = await this.prisma.userRole.findFirstOrThrow({
      where: { id: assignmentId, userId, user: { organizationId: req.user.organizationId } },
      include: { role: true, user: { select: { email: true } } },
    });
    if (assignment.role.isMasterAdmin) {
      const remaining = await this.prisma.userRole.count({
        where: { role: { isMasterAdmin: true, organizationId: req.user.organizationId }, user: { status: 'ACTIVE' }, id: { not: assignmentId } },
      });
      if (remaining === 0) throw new BadRequestException('Cannot remove the last active Master Admin');
    }
    await this.prisma.userRole.delete({ where: { id: assignmentId } });
    await this.audit.record(actorFrom(req), {
      action: assignment.role.isMasterAdmin ? 'user.master_admin_revoked' : 'user.role_removed',
      entityType: 'user',
      entityId: userId,
      oldValue: { user: assignment.user.email, role: assignment.role.name, scopeType: assignment.scopeType, scopeId: assignment.scopeId },
    });
  }

  private async assertScope(orgId: string, scopeType: string, scopeId: string) {
    const where = { id: scopeId, organizationId: orgId };
    const n =
      scopeType === 'DEPARTMENT'
        ? await this.prisma.department.count({ where })
        : scopeType === 'TEAM'
          ? await this.prisma.team.count({ where })
          : await this.prisma.event.count({ where });
    if (!n) throw new BadRequestException(`${scopeType} not found`);
  }
}

@Module({
  controllers: [MasterAdminController, GatewayController, SecurityController],
  providers: [GatewaySettingsService],
})
export class MasterAdminModule {}

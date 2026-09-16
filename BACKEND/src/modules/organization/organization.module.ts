import { Controller, Get, Module, Req } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import type { AuthenticatedRequest } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Read-only organization profile. Editing lives in the Master Admin plane (PATCH /master/organization). */
@Controller('organization')
export class OrganizationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('organization.view')
  get(@Req() req: AuthenticatedRequest) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: req.user.organizationId },
      include: { _count: { select: { users: true, teams: true, events: true, departments: true } } },
    });
  }
}

@Module({ controllers: [OrganizationController] })
export class OrganizationModule {}

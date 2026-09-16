import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Req } from '@nestjs/common';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionService } from '../permissions/permission.service.js';

const updateModule = z.object({
  status: z.enum(['ENABLED', 'DISABLED']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/** Module Engine (arch doc §11): enable / disable / configure. */
@MasterOnly()
@Controller('master/modules')
export class ModulesRegistryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  @Get()
  list() {
    return this.prisma.module.findMany({
      orderBy: [{ phase: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { permissions: true } } },
    });
  }

  @Patch(':key')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Body(new ZodPipe(updateModule)) body: z.infer<typeof updateModule>,
  ) {
    const before = await this.prisma.module.findUniqueOrThrow({ where: { key } });
    if (before.isCore && body.status === 'DISABLED') throw new BadRequestException('Core modules cannot be disabled');

    const updated = await this.prisma.module.update({
      where: { key },
      data: { status: body.status, config: body.config as object | undefined },
    });
    this.permissions.invalidate();
    await this.audit.record(actorFrom(req), {
      action: body.status ? `module.${body.status === 'ENABLED' ? 'enabled' : 'disabled'}` : 'module.configured',
      entityType: 'module',
      entityId: key,
      oldValue: { status: before.status, config: before.config },
      newValue: { status: updated.status, config: updated.config },
    });
    return updated;
  }
}

@Module({ controllers: [ModulesRegistryController] })
export class ModulesRegistryModule {}

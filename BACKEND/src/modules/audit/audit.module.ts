import { Controller, Get, Module, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import type { AuthenticatedRequest } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const auditQuery = z.object({
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

@MasterOnly()
@Controller('master/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: req.user.organizationId,
        action: q.action ? { contains: q.action } : undefined,
        entityType: q.entityType,
        entityId: q.entityId,
        actorId: q.actorId,
        createdAt: { gte: q.from, lte: q.to },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
}

// AuditService itself is provided globally by CoreModule.
@Module({ controllers: [AuditController] })
export class AuditModule {}

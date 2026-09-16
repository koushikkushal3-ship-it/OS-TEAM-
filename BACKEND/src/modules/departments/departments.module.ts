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
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const departmentBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  parentId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});
type DepartmentBody = z.infer<typeof departmentBody>;

@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('department.view')
  list(@Req() req: AuthenticatedRequest) {
    return this.prisma.department.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true, teams: true, roles: true } } },
    });
  }

  @Post()
  @RequirePermission('department.create')
  async create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(departmentBody)) body: DepartmentBody) {
    const dept = await this.prisma.department.create({ data: { ...body, organizationId: req.user.organizationId } });
    await this.audit.record(actorFrom(req), { action: 'department.created', entityType: 'department', entityId: dept.id, newValue: body });
    return dept;
  }

  @Patch(':id')
  @RequirePermission('department.update')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(departmentBody.partial())) body: Partial<DepartmentBody>,
  ) {
    if (body.parentId === id) throw new BadRequestException('A department cannot be its own parent');
    const before = await this.prisma.department.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    const dept = await this.prisma.department.update({ where: { id }, data: body });
    await this.audit.record(actorFrom(req), {
      action: 'department.updated',
      entityType: 'department',
      entityId: id,
      oldValue: { name: before.name, description: before.description, parentId: before.parentId, isActive: before.isActive },
      newValue: body,
    });
    return dept;
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('department.delete')
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.department.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    await this.prisma.department.delete({ where: { id } });
    await this.audit.record(actorFrom(req), { action: 'department.deleted', entityType: 'department', entityId: id, oldValue: { name: before.name } });
  }
}

@Module({ controllers: [DepartmentsController] })
export class DepartmentsModule {}

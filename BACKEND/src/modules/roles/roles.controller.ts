import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionService } from '../permissions/permission.service.js';

const roleBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  departmentId: z.string().uuid().nullish(),
  reportsToRoleId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});
const createRole = roleBody.extend({ permissionKeys: z.array(z.string()).default([]) });
const permissionsBody = z.object({ permissionKeys: z.array(z.string()) });

type CreateRole = z.infer<typeof createRole>;
type UpdateRole = Partial<z.infer<typeof roleBody>>;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Custom Role Engine (arch doc §6) — Master Admin creates any role without code changes. */
@MasterOnly()
@Controller('master/roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.prisma.role.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
      include: {
        department: { select: { id: true, name: true } },
        reportsTo: { select: { id: true, name: true } },
        permissions: { select: { permissionKey: true } },
        _count: { select: { users: true } },
      },
    });
  }

  @Get(':id')
  async get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.role.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: {
        department: { select: { id: true, name: true } },
        reportsTo: { select: { id: true, name: true } },
        permissions: { select: { permissionKey: true } },
        users: {
          include: { user: { select: { id: true, name: true, email: true, status: true } } },
        },
      },
    });
  }

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createRole)) body: CreateRole) {
    await this.assertPermissionKeys(body.permissionKeys);
    const { permissionKeys, ...fields } = body;
    const role = await this.prisma.role.create({
      data: {
        ...fields,
        organizationId: req.user.organizationId,
        key: `${slugify(body.name)}_${Date.now().toString(36)}`,
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      include: { permissions: { select: { permissionKey: true } } },
    });
    this.permissions.invalidate(req.user.organizationId);
    await this.audit.record(actorFrom(req), {
      action: 'role.created',
      entityType: 'role',
      entityId: role.id,
      newValue: { name: role.name, permissions: permissionKeys },
    });
    return role;
  }

  @Patch(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(roleBody.partial())) body: UpdateRole,
  ) {
    const before = await this.prisma.role.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId } });
    if (before.isMasterAdmin && body.isActive === false) throw new BadRequestException('The Master Admin role cannot be deactivated');
    if (body.reportsToRoleId === id) throw new BadRequestException('A role cannot report to itself');

    const role = await this.prisma.role.update({ where: { id }, data: body });
    this.permissions.invalidate(req.user.organizationId);
    await this.audit.record(actorFrom(req), {
      action: 'role.updated',
      entityType: 'role',
      entityId: id,
      oldValue: pick(before, Object.keys(body)),
      newValue: body,
    });
    return role;
  }

  @Put(':id/permissions')
  async setPermissions(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(permissionsBody)) body: z.infer<typeof permissionsBody>,
  ) {
    const role = await this.prisma.role.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: { permissions: { select: { permissionKey: true } } },
    });
    if (role.isMasterAdmin) throw new BadRequestException('Master Admin access is not permission-based');
    await this.assertPermissionKeys(body.permissionKeys);

    const keys = [...new Set(body.permissionKeys)];
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({ data: keys.map((permissionKey) => ({ roleId: id, permissionKey })) }),
    ]);
    this.permissions.invalidate(req.user.organizationId);

    const old = role.permissions.map((p) => p.permissionKey).sort();
    await this.audit.record(actorFrom(req), {
      action: 'role.permissions_changed',
      entityType: 'role',
      entityId: id,
      oldValue: { role: role.name, permissions: old },
      newValue: {
        role: role.name,
        permissions: keys.sort(),
        added: keys.filter((k) => !old.includes(k)),
        removed: old.filter((k) => !keys.includes(k)),
      },
    });
    return { id, permissionKeys: keys };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const role = await this.prisma.role.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: { _count: { select: { users: true } } },
    });
    if (role.isSystem || role.isMasterAdmin) throw new BadRequestException('System roles cannot be deleted; deactivate them instead');
    if (role._count.users > 0) throw new BadRequestException('Remove this role from all people before deleting it');

    await this.prisma.role.delete({ where: { id } });
    this.permissions.invalidate(req.user.organizationId);
    await this.audit.record(actorFrom(req), { action: 'role.deleted', entityType: 'role', entityId: id, oldValue: { name: role.name } });
  }

  private async assertPermissionKeys(keys: string[]) {
    if (keys.length === 0) return;
    const found = await this.prisma.permission.count({ where: { key: { in: keys } } });
    if (found !== new Set(keys).size) throw new BadRequestException('Unknown permission key in list');
  }
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

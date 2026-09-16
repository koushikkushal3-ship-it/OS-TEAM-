import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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

const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  departmentId: z.string().uuid().nullish(),
});
const updateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  departmentId: z.string().uuid().nullish(),
});
const listQuery = z.object({
  search: z.string().optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']).optional(),
  departmentId: z.string().uuid().optional(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  roles: {
    select: {
      id: true,
      scopeType: true,
      scopeId: true,
      role: { select: { id: true, name: true, isMasterAdmin: true } },
    },
  },
  teamMemberships: { select: { memberRole: true, team: { select: { id: true, name: true } } } },
} as const;

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('user.view')
  async list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        status: q.status,
        departmentId: q.departmentId,
        ...(q.search && {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { email: { contains: q.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { name: 'asc' },
      select: userSelect,
    });
    return users.map((u) => this.present(u, req));
  }

  @Get(':id')
  @RequirePermission('user.view')
  async get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      select: userSelect,
    });
    return this.present(user, req);
  }

  /** Invite: the person can sign in with Google once their email is on record. */
  @Post()
  @RequirePermission('user.create')
  async invite(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(inviteBody)) body: z.infer<typeof inviteBody>) {
    const user = await this.prisma.user.create({
      data: { ...body, organizationId: req.user.organizationId, status: 'INVITED' },
      select: userSelect,
    });
    await this.audit.record(actorFrom(req), { action: 'user.invited', entityType: 'user', entityId: user.id, newValue: body });
    return this.present(user, req);
  }

  @Patch(':id')
  @RequirePermission('user.update')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>,
  ) {
    const before = await this.assertManageable(req, id);
    const user = await this.prisma.user.update({ where: { id }, data: body, select: userSelect });
    await this.audit.record(actorFrom(req), {
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      oldValue: { name: before.name, departmentId: before.departmentId },
      newValue: body,
    });
    return this.present(user, req);
  }

  @Post(':id/disable')
  @RequirePermission('user.disable')
  async disable(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    if (id === req.user.id) throw new BadRequestException('You cannot disable yourself');
    const before = await this.assertManageable(req, id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: 'DISABLED' } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record(actorFrom(req), { action: 'user.disabled', entityType: 'user', entityId: id, oldValue: { status: before.status }, newValue: { status: 'DISABLED' } });
    return { id, status: 'DISABLED' };
  }

  @Post(':id/enable')
  @RequirePermission('user.disable')
  async enable(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.assertManageable(req, id);
    const status = before.lastLoginAt ? 'ACTIVE' : 'INVITED';
    await this.prisma.user.update({ where: { id }, data: { status } });
    await this.audit.record(actorFrom(req), { action: 'user.enabled', entityType: 'user', entityId: id, oldValue: { status: before.status }, newValue: { status } });
    return { id, status };
  }

  /** Only a privileged Master Admin may modify another Master Admin. */
  private async assertManageable(req: AuthenticatedRequest, id: string) {
    const target = await this.prisma.user.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
      include: { roles: { include: { role: { select: { isMasterAdmin: true } } } } },
    });
    if (target.roles.some((r) => r.role.isMasterAdmin) && !req.auth.privileged) {
      throw new ForbiddenException('Only Master Admin can modify this person');
    }
    return target;
  }

  /** Master Admin role assignments are hidden from everyone outside the control plane. */
  private present<T extends { roles: { role: { isMasterAdmin: boolean } }[] }>(user: T, req: AuthenticatedRequest) {
    if (req.auth.privileged) return user;
    return { ...user, roles: user.roles.filter((r) => !r.role.isMasterAdmin) };
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}

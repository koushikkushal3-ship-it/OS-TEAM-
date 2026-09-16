import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { applyAccessPreset, detectPreset } from './access-presets.js';
import { PermissionService } from './permission.service.js';

const SCOPES = ['GLOBAL', 'ORGANIZATION', 'DEPARTMENT', 'TEAM', 'EVENT', 'ROLE', 'USER'] as const;
type Scope = (typeof SCOPES)[number];

const overrideBody = z.object({
  scopeType: z.enum(SCOPES),
  scopeId: z.string().optional(),
  permissionKey: z.string().min(1),
  effect: z.enum(['ALLOW', 'DENY']),
  note: z.string().max(300).optional(),
  expiresAt: z.coerce.date().nullish(),
});

const presetBody = z.object({
  scopeType: z.enum(SCOPES),
  scopeId: z.string().optional(),
  moduleKey: z.string().min(1),
  preset: z.enum(['DEFAULT', 'DENIED', 'VIEW_ONLY', 'FULL']),
  /** Temporary access: the override stops counting after this moment. */
  expiresAt: z.coerce.date().nullish(),
});

const accessQuery = z.object({
  scopeType: z.enum(SCOPES),
  scopeId: z.string().optional(),
});

const explainQuery = z.object({
  userId: z.string().uuid(),
  action: z.string().min(1),
  teamId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
});


@MasterOnly()
@Controller('master/permissions')
export class PermissionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
  ) {}

  /** Permission catalog grouped by module. */
  @Get()
  async catalog() {
    const modules = await this.prisma.module.findMany({
      orderBy: [{ phase: 'asc' }, { name: 'asc' }],
      include: { permissions: { orderBy: { key: 'asc' } } },
    });
    return modules.map((m) => ({
      key: m.key,
      name: m.name,
      phase: m.phase,
      status: m.status,
      isCore: m.isCore,
      permissions: m.permissions.map((p) => ({ key: p.key, description: p.description })),
    }));
  }

  @Get('overrides')
  overrides(@Req() req: AuthenticatedRequest) {
    return this.prisma.permissionOverride.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ scopeType: 'asc' }, { permissionKey: 'asc' }],
    });
  }

  @Post('overrides')
  async upsertOverride(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(overrideBody)) body: z.infer<typeof overrideBody>) {
    const orgId = req.user.organizationId;
    const scopeId = await this.resolveScope(orgId, body.scopeType, body.scopeId);
    await this.assertKey(body.permissionKey);

    const where = {
      organizationId_scopeType_scopeId_permissionKey: {
        organizationId: orgId,
        scopeType: body.scopeType,
        scopeId,
        permissionKey: body.permissionKey,
      },
    };
    const before = await this.prisma.permissionOverride.findUnique({ where });
    const saved = await this.prisma.permissionOverride.upsert({
      where,
      create: { ...body, expiresAt: body.expiresAt ?? null, scopeId, organizationId: orgId, createdById: req.user.id },
      update: { effect: body.effect, note: body.note, createdById: req.user.id, expiresAt: body.expiresAt ?? null },
    });
    this.permissions.invalidate(orgId);
    await this.audit.record(actorFrom(req), {
      action: 'permission.override_set',
      entityType: 'permission_override',
      entityId: saved.id,
      oldValue: before ? { effect: before.effect } : { effect: 'INHERITED' },
      newValue: { scope: `${body.scopeType}:${await this.scopeLabel(body.scopeType, scopeId)}`, permissionKey: body.permissionKey, effect: body.effect },
    });
    return saved;
  }

  @Delete('overrides/:id')
  @HttpCode(204)
  async deleteOverride(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.prisma.permissionOverride.findFirstOrThrow({
      where: { id, organizationId: req.user.organizationId },
    });
    await this.prisma.permissionOverride.delete({ where: { id } });
    this.permissions.invalidate(req.user.organizationId);
    await this.audit.record(actorFrom(req), {
      action: 'permission.override_removed',
      entityType: 'permission_override',
      entityId: id,
      oldValue: { scopeType: before.scopeType, scopeId: before.scopeId, permissionKey: before.permissionKey, effect: before.effect },
      newValue: { effect: 'INHERITED' },
    });
  }

  /**
   * Module access presets for one scope, e.g. "Creative Lead → Finance: VIEW ONLY" (arch doc §39 example).
   * Replaces that scope's overrides for the module.
   */
  @Post('presets')
  async applyPreset(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(presetBody)) body: z.infer<typeof presetBody>) {
    const orgId = req.user.organizationId;
    const scopeId = await this.resolveScope(orgId, body.scopeType, body.scopeId);
    const result = await applyAccessPreset(this.prisma, {
      organizationId: orgId,
      scopeType: body.scopeType,
      scopeId,
      moduleKey: body.moduleKey,
      preset: body.preset,
      expiresAt: body.preset === 'DEFAULT' ? null : body.expiresAt,
      userId: req.user.id,
    });
    this.permissions.invalidate(orgId);

    const scope = await this.scopeLabel(body.scopeType, scopeId);
    await this.audit.record(actorFrom(req), {
      action: 'permission.access_changed',
      entityType: 'permission_override',
      entityId: scopeId,
      // Keys are kept alongside the labels so the change can be undone from the audit log.
      oldValue: { scope, module: result.moduleName, access: result.oldPreset, expiresAt: result.oldExpiresAt },
      newValue: { scope, module: result.moduleName, access: body.preset, expiresAt: body.expiresAt ?? null, scopeType: body.scopeType, moduleKey: body.moduleKey },
    });
    return { scopeType: body.scopeType, scopeId, moduleKey: body.moduleKey, preset: body.preset, expiresAt: body.expiresAt ?? null };
  }

  /**
   * What one scope — usually one person — can currently open, module by module.
   * Powers the Access screen in People: it needs the *current* preset to show,
   * which `detectPreset` derives from the overrides already stored.
   */
  @Get('access')
  async access(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(accessQuery)) q: z.infer<typeof accessQuery>) {
    const orgId = req.user.organizationId;
    const scopeId = await this.resolveScope(orgId, q.scopeType, q.scopeId);
    const [modules, overrides] = await Promise.all([
      this.prisma.module.findMany({
        where: { status: 'ENABLED' },
        orderBy: [{ phase: 'asc' }, { name: 'asc' }],
        include: { permissions: { select: { key: true }, orderBy: { key: 'asc' } } },
      }),
      this.prisma.permissionOverride.findMany({
        where: { organizationId: orgId, scopeType: q.scopeType, scopeId },
        select: { permissionKey: true, effect: true, expiresAt: true },
      }),
    ]);

    return modules.map((m) => {
      const keys = m.permissions.map((p) => p.key);
      const prefix = keys[0]?.split('.')[0];
      const viewKey = keys.find((k) => k.endsWith('.view'));
      const mine = overrides.filter((o) => keys.includes(o.permissionKey) || o.permissionKey === `${prefix}.*`);
      return {
        key: m.key,
        name: m.name,
        description: m.description,
        phase: m.phase,
        isCore: m.isCore,
        canViewOnly: Boolean(viewKey),
        preset: detectPreset(mine, prefix, viewKey),
        expiresAt: mine.find((o) => o.expiresAt)?.expiresAt ?? null,
      };
    });
  }

  /** "Why can / can't this person do X?" — debugging aid for Master Admin. */
  @Get('explain')
  async explain(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(explainQuery)) q: z.infer<typeof explainQuery>) {
    await this.prisma.user.findFirstOrThrow({ where: { id: q.userId, organizationId: req.user.organizationId } });
    const ctx = await this.permissions.buildContext(q.userId, { id: 'explain', privilegedUntil: null });
    return this.permissions.explain(ctx, q.action, { teamId: q.teamId, eventId: q.eventId });
  }

  private async resolveScope(orgId: string, scopeType: Scope, scopeId?: string): Promise<string> {
    if (scopeType === 'GLOBAL') return 'global';
    if (scopeType === 'ORGANIZATION') return orgId;
    if (!scopeId) throw new BadRequestException('scopeId is required for this scope');

    const where = { id: scopeId, organizationId: orgId };
    const exists =
      scopeType === 'DEPARTMENT'
        ? await this.prisma.department.count({ where })
        : scopeType === 'TEAM'
          ? await this.prisma.team.count({ where })
          : scopeType === 'EVENT'
            ? await this.prisma.event.count({ where })
            : scopeType === 'ROLE'
              ? await this.prisma.role.count({ where })
              : await this.prisma.user.count({ where });
    if (!exists) throw new BadRequestException(`${scopeType} not found`);
    return scopeId;
  }

  private async scopeLabel(scopeType: Scope, scopeId: string): Promise<string> {
    const select = { name: true } as const;
    const row =
      scopeType === 'DEPARTMENT'
        ? await this.prisma.department.findUnique({ where: { id: scopeId }, select })
        : scopeType === 'TEAM'
          ? await this.prisma.team.findUnique({ where: { id: scopeId }, select })
          : scopeType === 'EVENT'
            ? await this.prisma.event.findUnique({ where: { id: scopeId }, select })
            : scopeType === 'ROLE'
              ? await this.prisma.role.findUnique({ where: { id: scopeId }, select })
              : scopeType === 'USER'
                ? await this.prisma.user.findUnique({ where: { id: scopeId }, select })
                : null;
    return row?.name ?? scopeType;
  }

  private async assertKey(key: string) {
    if (key === '*') return;
    if (key.endsWith('.*')) {
      const n = await this.prisma.permission.count({ where: { key: { startsWith: key.slice(0, -1) } } });
      if (n > 0) return;
    } else if (await this.prisma.permission.count({ where: { key } })) {
      return;
    }
    throw new BadRequestException(`Unknown permission key "${key}"`);
  }
}

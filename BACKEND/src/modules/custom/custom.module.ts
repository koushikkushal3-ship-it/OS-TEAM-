import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import {
  type DefinitionInput,
  type FieldDef,
  buildRecordSchema,
  definitionSchema,
  moduleKeyFor,
  permissionsFor,
} from './field-schema.js';
import { recycle, requestSecondApproval } from '../platform/records.js';

const recordSchema = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(40),
  data: z.record(z.string(), z.unknown()).default({}),
  teamId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
});

const listSchema = z.object({
  status: z.string().optional(),
  eventId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(200),
});

const definitionSelect = {
  id: true,
  moduleKey: true,
  name: true,
  description: true,
  icon: true,
  fields: true,
  statuses: true,
  scopeEvent: true,
  scopeTeam: true,
  createdAt: true,
  _count: { select: { records: true } },
} as const;

const recordSelect = {
  id: true,
  title: true,
  status: true,
  data: true,
  createdAt: true,
  updatedAt: true,
  teamId: true,
  eventId: true,
  team: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, avatarUrl: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/**
 * The platform builder (arch doc §12, §18). A module Master Admin defines here
 * registers a real row in `modules` plus its own permissions, so the existing
 * permission engine, role editor, override cascade and enable switch all apply
 * to it with no special cases.
 */
@Injectable()
export class CustomModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  listDefinitions(auth: AuthContext) {
    return this.prisma.customModule.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { name: 'asc' },
      select: definitionSelect,
    });
  }

  /** Definitions the person can actually open, for navigation. */
  async listAvailable(auth: AuthContext) {
    const definitions = await this.prisma.customModule.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { name: 'asc' },
      select: definitionSelect,
    });

    const available = [];
    for (const definition of definitions) {
      if (await this.permissions.can(auth, `${definition.moduleKey}.view`)) available.push(definition);
    }
    return available;
  }

  async getDefinition(auth: AuthContext, moduleKey: string) {
    const definition = await this.prisma.customModule.findFirst({
      where: { moduleKey, organizationId: auth.organizationId },
      select: definitionSelect,
    });
    if (!definition) throw new NotFoundException('Module not found');
    await this.permissions.assert(auth, `${moduleKey}.view`);

    const [canCreate, canUpdate, canDelete] = await Promise.all([
      this.permissions.can(auth, `${moduleKey}.create`),
      this.permissions.can(auth, `${moduleKey}.update`),
      this.permissions.can(auth, `${moduleKey}.delete`),
    ]);
    return { ...definition, capabilities: { canCreate, canUpdate, canDelete } };
  }

  async create(auth: AuthContext, actor: AuditActor, input: DefinitionInput) {
    const moduleKey = moduleKeyFor(input.name);
    if (await this.prisma.module.count({ where: { key: moduleKey } })) {
      throw new BadRequestException('A module with a similar name already exists');
    }

    // The module row and its permissions first: without them the engine would
    // deny every request to the new module.
    await this.prisma.$transaction([
      this.prisma.module.create({
        data: {
          key: moduleKey,
          name: input.name,
          description: input.description ?? `Custom module: ${input.name}`,
          phase: 6,
          status: 'ENABLED',
        },
      }),
      this.prisma.permission.createMany({
        data: permissionsFor(moduleKey, input.name).map((p) => ({ ...p, moduleKey })),
      }),
    ]);

    const definition = await this.prisma.customModule.create({
      data: {
        organizationId: auth.organizationId,
        moduleKey,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon,
        fields: input.fields,
        statuses: input.statuses,
        scopeEvent: input.scopeEvent,
        scopeTeam: input.scopeTeam,
        createdById: auth.userId,
      },
      select: definitionSelect,
    });
    this.permissions.invalidate();

    await this.audit.record(actor, {
      action: 'custom_module.created',
      entityType: 'custom_module',
      entityId: definition.id,
      newValue: { moduleKey, name: input.name, fields: input.fields.length, statuses: input.statuses },
    });
    return definition;
  }

  async update(auth: AuthContext, actor: AuditActor, id: string, input: DefinitionInput) {
    const before = await this.prisma.customModule.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
    });

    const definition = await this.prisma.customModule.update({
      where: { id },
      data: {
        // The key never changes: existing permissions and role grants hang off it.
        name: input.name,
        description: input.description ?? null,
        icon: input.icon,
        fields: input.fields,
        statuses: input.statuses,
        scopeEvent: input.scopeEvent,
        scopeTeam: input.scopeTeam,
      },
      select: definitionSelect,
    });
    await this.prisma.module.update({ where: { key: before.moduleKey }, data: { name: input.name } });
    this.permissions.invalidate();

    await this.audit.record(actor, {
      action: 'custom_module.updated',
      entityType: 'custom_module',
      entityId: id,
      oldValue: { name: before.name, fields: before.fields, statuses: before.statuses },
      newValue: { name: input.name, fields: input.fields, statuses: input.statuses },
    });
    return definition;
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.customModule.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      include: { _count: { select: { records: true } } },
    });

    // Records, permissions and role grants all go with it.
    await this.prisma.$transaction([
      this.prisma.customModule.delete({ where: { id } }),
      this.prisma.permission.deleteMany({ where: { moduleKey: before.moduleKey } }),
      this.prisma.permissionOverride.deleteMany({
        where: { organizationId: auth.organizationId, permissionKey: { startsWith: `${before.moduleKey}.` } },
      }),
      this.prisma.module.delete({ where: { key: before.moduleKey } }),
    ]);
    this.permissions.invalidate();

    await this.audit.record(actor, {
      action: 'custom_module.deleted',
      entityType: 'custom_module',
      entityId: id,
      oldValue: { moduleKey: before.moduleKey, name: before.name, records: before._count.records },
    });
  }

  // ── records ──────────────────────────────────────────────────

  private async definitionOrThrow(auth: AuthContext, moduleKey: string) {
    const definition = await this.prisma.customModule.findFirst({
      where: { moduleKey, organizationId: auth.organizationId },
    });
    if (!definition) throw new NotFoundException('Module not found');
    return definition;
  }

  async listRecords(auth: AuthContext, moduleKey: string, q: z.infer<typeof listSchema>) {
    const definition = await this.definitionOrThrow(auth, moduleKey);
    await this.permissions.assert(auth, `${moduleKey}.view`, { teamId: q.teamId, eventId: q.eventId });

    return this.prisma.customRecord.findMany({
      where: {
        customModuleId: definition.id,
        organizationId: auth.organizationId,
        status: q.status,
        eventId: q.eventId,
        teamId: q.teamId,
        ...(q.mine && { OR: [{ ownerId: auth.userId }, { createdById: auth.userId }] }),
      },
      orderBy: { updatedAt: 'desc' },
      take: q.limit,
      select: recordSelect,
    });
  }

  async saveRecord(
    auth: AuthContext,
    actor: AuditActor,
    moduleKey: string,
    input: z.infer<typeof recordSchema>,
    id?: string,
  ) {
    const definition = await this.definitionOrThrow(auth, moduleKey);
    const target = { teamId: input.teamId ?? undefined, eventId: input.eventId ?? undefined };
    await this.permissions.assert(auth, `${moduleKey}.${id ? 'update' : 'create'}`, target);

    const statuses = definition.statuses as string[];
    if (!statuses.includes(input.status)) throw new BadRequestException(`Status must be one of: ${statuses.join(', ')}`);

    // The definition's own fields decide what a valid record looks like.
    const parsed = buildRecordSchema(definition.fields as unknown as FieldDef[]).safeParse(input.data);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    await this.assertRefs(auth, input);

    const data = {
      title: input.title,
      status: input.status,
      data: parsed.data as object,
      teamId: definition.scopeTeam ? (input.teamId ?? null) : null,
      eventId: definition.scopeEvent ? (input.eventId ?? null) : null,
      ownerId: input.ownerId ?? auth.userId,
    };

    if (!id) {
      const record = await this.prisma.customRecord.create({
        data: { ...data, organizationId: auth.organizationId, customModuleId: definition.id, createdById: auth.userId },
        select: recordSelect,
      });
      await this.audit.record(actor, {
        action: 'custom_record.created',
        entityType: moduleKey,
        entityId: record.id,
        newValue: { title: record.title, status: record.status },
      });
      return record;
    }

    const before = await this.prisma.customRecord.findFirstOrThrow({
      where: { id, customModuleId: definition.id, organizationId: auth.organizationId },
    });
    const record = await this.prisma.customRecord.update({ where: { id }, data, select: recordSelect });
    await this.audit.record(actor, {
      action: 'custom_record.updated',
      entityType: moduleKey,
      entityId: id,
      oldValue: { title: before.title, status: before.status, data: before.data },
      newValue: { title: record.title, status: record.status, data: record.data },
    });
    return record;
  }

  async removeRecord(auth: AuthContext, actor: AuditActor, moduleKey: string, id: string) {
    const definition = await this.definitionOrThrow(auth, moduleKey);
    const before = await this.prisma.customRecord.findFirstOrThrow({
      where: { id, customModuleId: definition.id, organizationId: auth.organizationId },
    });
    await this.permissions.assert(auth, `${moduleKey}.delete`, {
      teamId: before.teamId ?? undefined,
      eventId: before.eventId ?? undefined,
    });

    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'custom_record', row: before, label: `${definition.name}: ${before.title}`, deletedById: auth.userId });
    await this.prisma.customRecord.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'custom_record.deleted',
      entityType: moduleKey,
      entityId: id,
      oldValue: { title: before.title, status: before.status },
    });
  }

  private async assertRefs(auth: AuthContext, input: { teamId?: string | null; eventId?: string | null; ownerId?: string | null }) {
    const organizationId = auth.organizationId;
    if (input.teamId && !(await this.prisma.team.count({ where: { id: input.teamId, organizationId } }))) {
      throw new BadRequestException('Team not found');
    }
    if (input.eventId && !(await this.prisma.event.count({ where: { id: input.eventId, organizationId } }))) {
      throw new BadRequestException('Event not found');
    }
    if (input.ownerId && !(await this.prisma.user.count({ where: { id: input.ownerId, organizationId } }))) {
      throw new BadRequestException('Owner not found');
    }
  }
}

/** Building modules is a control-plane act. */
@MasterOnly()
@Controller('master/builder')
export class BuilderController {
  constructor(
    private readonly custom: CustomModulesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.custom.listDefinitions(req.auth);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(definitionSchema)) body: DefinitionInput) {
    return this.custom.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(definitionSchema)) body: DefinitionInput,
  ) {
    return this.custom.update(req.auth, actorFrom(req), id, body);
  }

  /** Returns `{ pendingApproval }` when a second Master Admin must approve first. */
  @Delete(':id')
  async remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const definition = await this.prisma.customModule.findFirstOrThrow({ where: { id, organizationId: req.user.organizationId }, include: { _count: { select: { records: true } } } });
    const pending = await requestSecondApproval(this.prisma, {
      organizationId: req.user.organizationId,
      requestedById: req.user.id,
      kind: 'DELETE_CUSTOM_MODULE',
      summary: `Delete the module "${definition.name}" and its ${definition._count.records} record(s)`,
      payload: { moduleId: id },
    });
    if (pending) return pending;
    await this.custom.remove(req.auth, actorFrom(req), id);
    return { deleted: true };
  }
}

/** Using a custom module is ordinary work, open to anyone the permissions allow. */
@Controller('custom')
export class CustomRecordsController {
  constructor(private readonly custom: CustomModulesService) {}

  @Get()
  available(@Req() req: AuthenticatedRequest) {
    return this.custom.listAvailable(req.auth);
  }

  @Get(':moduleKey')
  definition(@Req() req: AuthenticatedRequest, @Param('moduleKey') moduleKey: string) {
    return this.custom.getDefinition(req.auth, moduleKey);
  }

  @Get(':moduleKey/records')
  listRecords(
    @Req() req: AuthenticatedRequest,
    @Param('moduleKey') moduleKey: string,
    @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>,
  ) {
    return this.custom.listRecords(req.auth, moduleKey, q);
  }

  @Post(':moduleKey/records')
  createRecord(
    @Req() req: AuthenticatedRequest,
    @Param('moduleKey') moduleKey: string,
    @Body(new ZodPipe(recordSchema)) body: z.infer<typeof recordSchema>,
  ) {
    return this.custom.saveRecord(req.auth, actorFrom(req), moduleKey, body);
  }

  @Patch(':moduleKey/records/:id')
  updateRecord(
    @Req() req: AuthenticatedRequest,
    @Param('moduleKey') moduleKey: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(recordSchema)) body: z.infer<typeof recordSchema>,
  ) {
    return this.custom.saveRecord(req.auth, actorFrom(req), moduleKey, body, id);
  }

  @Delete(':moduleKey/records/:id')
  @HttpCode(204)
  removeRecord(
    @Req() req: AuthenticatedRequest,
    @Param('moduleKey') moduleKey: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.custom.removeRecord(req.auth, actorFrom(req), moduleKey, id);
  }
}

@Module({
  controllers: [BuilderController, CustomRecordsController],
  providers: [CustomModulesService],
  exports: [CustomModulesService],
})
export class CustomModulesModule {}

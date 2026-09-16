import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { recycle } from '../platform/records.js';

const TYPES = ['SPONSOR', 'GUEST', 'VENDOR', 'VENUE', 'COLLABORATION', 'INVITATION', 'PARTNER'] as const;
const STATUSES = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'NEGOTIATING', 'CONFIRMED', 'REJECTED', 'CLOSED'] as const;

type OpportunityType = (typeof TYPES)[number];

/**
 * Each opportunity type maps to its own module and permission pair, so Master Admin
 * can let one role handle sponsors while another handles vendors (arch doc §34).
 */
const PERMISSION: Record<OpportunityType, { view: string; manage: string }> = {
  SPONSOR: { view: 'sponsor.view', manage: 'sponsor.manage' },
  GUEST: { view: 'guest.view', manage: 'guest.manage' },
  VENDOR: { view: 'vendor.view', manage: 'vendor.manage' },
  VENUE: { view: 'venue.view', manage: 'venue.manage' },
  COLLABORATION: { view: 'invitation.view', manage: 'invitation.manage' },
  INVITATION: { view: 'invitation.view', manage: 'invitation.manage' },
  PARTNER: { view: 'invitation.view', manage: 'invitation.manage' },
};

const createSchema = z.object({
  type: z.enum(TYPES),
  name: z.string().trim().min(2).max(160),
  organizationName: z.string().trim().max(160).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactEmail: z.string().trim().email().max(160).nullish().or(z.literal('')),
  contactPhone: z.string().trim().max(40).nullish(),
  description: z.string().trim().max(4000).nullish(),
  value: z.number().nonnegative().nullish(),
  eventId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  ownerId: z.string().uuid().nullish(),
  nextActionAt: z.coerce.date().nullish(),
});

const updateSchema = createSchema.partial().extend({ status: z.enum(STATUSES).optional() });

const listSchema = z.object({
  type: z.enum(TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  eventId: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(200),
});

const activitySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  kind: z.enum(['note', 'call', 'email', 'meeting']).default('note'),
});

const select = {
  id: true,
  type: true,
  name: true,
  organizationName: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  description: true,
  value: true,
  status: true,
  nextActionAt: true,
  createdAt: true,
  updatedAt: true,
  teamId: true,
  eventId: true,
  team: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, avatarUrl: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { activity: true } },
} as const;

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: z.infer<typeof listSchema>) {
    const rows = await this.prisma.opportunity.findMany({
      where: {
        organizationId: auth.organizationId,
        type: q.type,
        status: q.status,
        eventId: q.eventId,
        ...(q.mine && { OR: [{ ownerId: auth.userId }, { createdById: auth.userId }] }),
      },
      orderBy: [{ nextActionAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: q.limit,
      select,
    });

    // Someone allowed to see sponsors may not be allowed to see vendors.
    const visible = [];
    for (const row of rows) {
      const own = row.owner?.id === auth.userId || row.createdBy?.id === auth.userId;
      if (own || (await this.can(auth, row, 'view'))) visible.push(row);
    }
    return visible;
  }

  async get(auth: AuthContext, id: string) {
    const opportunity = await this.prisma.opportunity.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      select: {
        ...select,
        activity: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, kind: true, message: true, createdAt: true, user: { select: { id: true, name: true } } },
        },
      },
    });
    await this.assertCan(auth, opportunity, 'view');
    return { ...opportunity, capabilities: { canManage: await this.can(auth, opportunity, 'manage') } };
  }

  async create(auth: AuthContext, actor: AuditActor, input: z.infer<typeof createSchema>) {
    await this.assertCan(auth, { type: input.type, teamId: input.teamId ?? null, eventId: input.eventId ?? null }, 'manage');
    await this.assertRefs(auth, input);

    const opportunity = await this.prisma.opportunity.create({
      data: {
        ...input,
        contactEmail: input.contactEmail || null,
        organizationId: auth.organizationId,
        createdById: auth.userId,
        ownerId: input.ownerId ?? auth.userId,
      },
      select,
    });
    await this.audit.record(actor, {
      action: 'opportunity.created',
      entityType: 'opportunity',
      entityId: opportunity.id,
      newValue: { type: input.type, name: input.name, eventId: input.eventId, value: input.value },
    });
    return opportunity;
  }

  async update(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof updateSchema>) {
    const before = await this.prisma.opportunity.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.assertCan(auth, before, 'manage');
    await this.assertRefs(auth, input);

    const opportunity = await this.prisma.opportunity.update({
      where: { id },
      data: { ...input, ...(input.contactEmail === '' ? { contactEmail: null } : {}) },
      select,
    });

    if (input.status && input.status !== before.status) {
      await this.prisma.opportunityActivity.create({
        data: { opportunityId: id, userId: auth.userId, kind: 'change', message: `Status: ${before.status} → ${input.status}` },
      });
    }
    await this.audit.record(actor, {
      action: input.status && input.status !== before.status ? `opportunity.${input.status.toLowerCase()}` : 'opportunity.updated',
      entityType: 'opportunity',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])),
      newValue: input,
    });
    return opportunity;
  }

  async addActivity(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof activitySchema>) {
    const opportunity = await this.prisma.opportunity.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.assertCan(auth, opportunity, 'manage');

    const entry = await this.prisma.opportunityActivity.create({
      data: { opportunityId: id, userId: auth.userId, kind: input.kind, message: input.message },
      select: { id: true, kind: true, message: true, createdAt: true, user: { select: { id: true, name: true } } },
    });
    await this.audit.record(actor, {
      action: 'opportunity.activity_added',
      entityType: 'opportunity',
      entityId: id,
      newValue: { kind: input.kind, message: input.message },
    });
    return entry;
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.opportunity.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.assertCan(auth, before, 'manage');
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'opportunity', row: before, label: before.name, deletedById: auth.userId, children: [{ model: 'opportunityActivity', rows: await this.prisma.opportunityActivity.findMany({ where: { opportunityId: id } }) }] });
    await this.prisma.opportunity.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'opportunity.deleted',
      entityType: 'opportunity',
      entityId: id,
      oldValue: { type: before.type, name: before.name, status: before.status },
    });
  }

  /** Pipeline totals per type and status, plus confirmed value. */
  async stats(auth: AuthContext, q: { eventId?: string }) {
    const where = { organizationId: auth.organizationId, eventId: q.eventId };
    const [byType, byStatus, confirmed] = await Promise.all([
      this.prisma.opportunity.groupBy({ by: ['type'], where, _count: true }),
      this.prisma.opportunity.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.opportunity.aggregate({ where: { ...where, status: 'CONFIRMED' }, _sum: { value: true }, _count: true }),
    ]);
    return {
      total: byType.reduce((n, t) => n + t._count, 0),
      byType: Object.fromEntries(byType.map((t) => [t.type, t._count])),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      confirmed: { count: confirmed._count, value: Number(confirmed._sum.value ?? 0) },
    };
  }

  // ── helpers ──────────────────────────────────────────────────

  private can(auth: AuthContext, row: { type: string; teamId: string | null; eventId: string | null }, action: 'view' | 'manage') {
    return this.permissions.can(auth, PERMISSION[row.type as OpportunityType][action], {
      teamId: row.teamId ?? undefined,
      eventId: row.eventId ?? undefined,
    });
  }

  private assertCan(auth: AuthContext, row: { type: string; teamId: string | null; eventId: string | null }, action: 'view' | 'manage') {
    return this.permissions.assert(auth, PERMISSION[row.type as OpportunityType][action], {
      teamId: row.teamId ?? undefined,
      eventId: row.eventId ?? undefined,
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
    if (input.ownerId && !(await this.prisma.user.count({ where: { id: input.ownerId, organizationId, status: { not: 'DISABLED' } } }))) {
      throw new BadRequestException('Owner not found');
    }
  }
}

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.opportunities.list(req.auth, q);
  }

  @Get('stats')
  stats(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodPipe(z.object({ eventId: z.string().uuid().optional() }))) q: { eventId?: string },
  ) {
    return this.opportunities.stats(req.auth, q);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.get(req.auth, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.opportunities.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.opportunities.update(req.auth, actorFrom(req), id, body);
  }

  @Post(':id/activity')
  addActivity(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(activitySchema)) body: z.infer<typeof activitySchema>,
  ) {
    return this.opportunities.addActivity(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.opportunities.remove(req.auth, actorFrom(req), id);
  }
}

@Module({ controllers: [OpportunitiesController], providers: [OpportunitiesService], exports: [OpportunitiesService] })
export class OpportunitiesModule {}

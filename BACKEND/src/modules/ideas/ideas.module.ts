import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { RequirePermission } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuditActor, type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { recycle } from '../platform/records.js';

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'IMPLEMENTING', 'IMPLEMENTED'] as const;

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.string().trim().min(2).max(60),
  summary: z.string().trim().min(10).max(5000),
  eventId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
});

const reviewSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(2000).nullish(),
});

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  mine: z.coerce.boolean().optional(),
  eventId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
});

const ideaSelect = {
  id: true,
  title: true,
  category: true,
  summary: true,
  status: true,
  decisionNote: true,
  reviewedAt: true,
  createdAt: true,
  teamId: true,
  eventId: true,
  team: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true, avatarUrl: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const;

/**
 * Ideas are formal, document-based submissions — a record with a PDF attached,
 * reviewed and decided, never a chat thread (arch doc §33).
 */
@Injectable()
export class IdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, q: z.infer<typeof listSchema>) {
    return this.prisma.idea.findMany({
      where: {
        organizationId: auth.organizationId,
        status: q.status,
        eventId: q.eventId,
        ...(q.mine && { submittedById: auth.userId }),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: ideaSelect,
    });
  }

  async get(auth: AuthContext, id: string) {
    const idea = await this.prisma.idea.findFirstOrThrow({
      where: { id, organizationId: auth.organizationId },
      select: ideaSelect,
    });
    const canReview = await this.permissions.can(auth, 'idea.review', {
      teamId: idea.teamId ?? undefined,
      eventId: idea.eventId ?? undefined,
    });
    return {
      ...idea,
      capabilities: { canReview, canEdit: idea.submittedBy?.id === auth.userId && idea.status === 'SUBMITTED' },
    };
  }

  async create(auth: AuthContext, actor: AuditActor, input: z.infer<typeof createSchema>) {
    await this.permissions.assert(auth, 'idea.submit', {
      teamId: input.teamId ?? undefined,
      eventId: input.eventId ?? undefined,
    });
    await this.assertRefs(auth, input);

    const idea = await this.prisma.idea.create({
      data: { ...input, organizationId: auth.organizationId, submittedById: auth.userId },
      select: ideaSelect,
    });
    await this.audit.record(actor, {
      action: 'idea.submitted',
      entityType: 'idea',
      entityId: idea.id,
      newValue: { title: idea.title, category: idea.category },
    });
    return idea;
  }

  /** The author can fix their own submission until a reviewer picks it up. */
  async update(auth: AuthContext, actor: AuditActor, id: string, input: Partial<z.infer<typeof createSchema>>) {
    const before = await this.prisma.idea.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    const isAuthor = before.submittedById === auth.userId;
    if (!isAuthor || before.status !== 'SUBMITTED') {
      await this.permissions.assert(auth, 'idea.review', {
        teamId: before.teamId ?? undefined,
        eventId: before.eventId ?? undefined,
      });
    }
    await this.assertRefs(auth, input);

    const idea = await this.prisma.idea.update({ where: { id }, data: input, select: ideaSelect });
    await this.audit.record(actor, {
      action: 'idea.updated',
      entityType: 'idea',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])),
      newValue: input,
    });
    return idea;
  }

  async review(auth: AuthContext, actor: AuditActor, id: string, input: z.infer<typeof reviewSchema>) {
    const before = await this.prisma.idea.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'idea.review', {
      teamId: before.teamId ?? undefined,
      eventId: before.eventId ?? undefined,
    });

    const idea = await this.prisma.idea.update({
      where: { id },
      data: { status: input.status, decisionNote: input.note, reviewedById: auth.userId, reviewedAt: new Date() },
      select: ideaSelect,
    });
    await this.audit.record(actor, {
      action: `idea.${input.status.toLowerCase()}`,
      entityType: 'idea',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status: input.status, note: input.note },
    });
    return idea;
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const before = await this.prisma.idea.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    const isAuthor = before.submittedById === auth.userId;
    if (!isAuthor && !(await this.permissions.can(auth, 'idea.review'))) {
      throw new ForbiddenException('You cannot delete this idea');
    }
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'idea', row: before, label: before.title, deletedById: auth.userId });
    await this.prisma.idea.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'idea.deleted',
      entityType: 'idea',
      entityId: id,
      oldValue: { title: before.title, status: before.status },
    });
  }

  async stats(auth: AuthContext) {
    const byStatus = await this.prisma.idea.groupBy({
      by: ['status'],
      where: { organizationId: auth.organizationId },
      _count: true,
    });
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    return {
      total: byStatus.reduce((n, s) => n + s._count, 0),
      awaitingReview: (counts.SUBMITTED ?? 0) + (counts.UNDER_REVIEW ?? 0),
      accepted: (counts.ACCEPTED ?? 0) + (counts.IMPLEMENTING ?? 0) + (counts.IMPLEMENTED ?? 0),
      implemented: counts.IMPLEMENTED ?? 0,
      byStatus: counts,
    };
  }

  private async assertRefs(auth: AuthContext, input: { teamId?: string | null; eventId?: string | null }) {
    const organizationId = auth.organizationId;
    if (input.teamId && !(await this.prisma.team.count({ where: { id: input.teamId, organizationId } }))) {
      throw new BadRequestException('Team not found');
    }
    if (input.eventId && !(await this.prisma.event.count({ where: { id: input.eventId, organizationId } }))) {
      throw new BadRequestException('Event not found');
    }
  }
}

@Controller('ideas')
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @Get()
  @RequirePermission('idea.view')
  list(@Req() req: AuthenticatedRequest, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.ideas.list(req.auth, q);
  }

  @Get('stats')
  @RequirePermission('idea.view')
  stats(@Req() req: AuthenticatedRequest) {
    return this.ideas.stats(req.auth);
  }

  @Get(':id')
  @RequirePermission('idea.view')
  get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.ideas.get(req.auth, id);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.ideas.create(req.auth, actorFrom(req), body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createSchema.partial())) body: Partial<z.infer<typeof createSchema>>,
  ) {
    return this.ideas.update(req.auth, actorFrom(req), id, body);
  }

  @Post(':id/review')
  review(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>,
  ) {
    return this.ideas.review(req.auth, actorFrom(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.ideas.remove(req.auth, actorFrom(req), id);
  }
}

@Module({ controllers: [IdeasController], providers: [IdeasService], exports: [IdeasService] })
export class IdeasModule {}

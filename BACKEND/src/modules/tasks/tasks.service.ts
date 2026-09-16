import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditActor } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import type { CreateTaskInput, ListTasksInput, ReviewInput, UpdateTaskInput, WorkUpdateInput } from './dto.js';
import type { TaskStatus } from '../../generated/prisma/enums.js';
import { notify, recycle } from '../platform/records.js';

const taskSelect = {
  id: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  percentage: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  parentTaskId: true,
  assignedToId: true,
  createdById: true,
  teamId: true,
  eventId: true,
  team: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { subtasks: true, updates: true } },
} as const;

const OPEN_STATUSES = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;

type TaskRef = {
  teamId: string | null;
  eventId: string | null;
  assignedToId?: string | null;
  createdById?: string | null;
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: ListTasksInput) {
    const scoped =
      q.scope === 'mine'
        ? { assignedToId: auth.userId }
        : q.scope === 'created'
          ? { createdById: auth.userId }
          : q.scope === 'team'
            ? { teamId: q.teamId }
            : q.scope === 'event'
              ? { eventId: q.eventId }
              : {};

    // Cheap pre-filter for people without organization-wide task.view; the
    // exact per-task check still runs below.
    const broadView = await this.permissions.can(auth, 'task.view');
    const fallback =
      q.scope === 'all' && !broadView
        ? { OR: [{ assignedToId: auth.userId }, { createdById: auth.userId }, { teamId: { in: auth.teamIds } }] }
        : {};

    const rows = await this.prisma.task.findMany({
      where: {
        organizationId: auth.organizationId,
        ...scoped,
        ...fallback,
        ...(q.teamId && { teamId: q.teamId }),
        ...(q.eventId && { eventId: q.eventId }),
        ...(q.assignedToId && { assignedToId: q.assignedToId }),
        ...(q.status && { status: q.status }),
        ...(q.open && { status: { in: [...OPEN_STATUSES] } }),
        ...(q.overdue && { dueDate: { lt: new Date() }, status: { in: [...OPEN_STATUSES] } }),
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: q.limit,
      select: taskSelect,
    });

    const visible = [];
    for (const task of rows) if (await this.canSee(auth, task)) visible.push(task);
    return visible;
  }

  async get(auth: AuthContext, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId: auth.organizationId },
      select: {
        ...taskSelect,
        parentTask: { select: { id: true, title: true } },
        subtasks: { select: taskSelect, orderBy: { createdAt: 'asc' } },
        updates: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            percentage: true,
            summary: true,
            blockers: true,
            status: true,
            createdAt: true,
            reviewedAt: true,
            reviewNote: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (!(await this.canSee(auth, task))) throw new ForbiddenException('You cannot view this task');

    return {
      ...task,
      capabilities: {
        canUpdate: await this.canManage(auth, task),
        canSubmitUpdate: await this.canSubmitUpdate(auth, task),
        canReview: await this.can(auth, 'work_update.review', task),
        canDelete: await this.can(auth, 'task.delete', task),
      },
    };
  }

  async create(auth: AuthContext, actor: AuditActor, input: CreateTaskInput) {
    const target = { teamId: input.teamId ?? undefined, eventId: input.eventId ?? undefined };
    await this.permissions.assert(auth, 'task.create', target);
    if (input.assignedToId && input.assignedToId !== auth.userId) {
      await this.permissions.assert(auth, 'task.assign', target);
    }
    await this.assertReferences(auth, input);

    const task = await this.prisma.task.create({
      data: {
        ...input,
        organizationId: auth.organizationId,
        createdById: auth.userId,
        status: input.status ?? (input.assignedToId ? 'ASSIGNED' : 'BACKLOG'),
      },
      select: taskSelect,
    });
    await this.audit.record(actor, {
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      newValue: { title: task.title, assignedToId: input.assignedToId, teamId: input.teamId, eventId: input.eventId },
    });
    await notify(this.prisma, {
      organizationId: auth.organizationId,
      userIds: [input.assignedToId],
      exceptUserId: auth.userId,
      type: 'task.assigned',
      title: `New task: ${task.title}`,
      link: `/tasks/${task.id}`,
    });
    return task;
  }

  async update(auth: AuthContext, actor: AuditActor, id: string, input: UpdateTaskInput) {
    const before = await this.prisma.task.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, before))) throw new ForbiddenException('You cannot edit this task');

    const reassigned = input.assignedToId !== undefined && input.assignedToId !== before.assignedToId;
    if (reassigned) {
      await this.permissions.assert(auth, 'task.assign', {
        teamId: (input.teamId ?? before.teamId) ?? undefined,
        eventId: (input.eventId ?? before.eventId) ?? undefined,
      });
    }
    await this.assertReferences(auth, input, id);

    const completing = input.status === 'COMPLETED' && before.status !== 'COMPLETED';
    const task = await this.prisma.task.update({
      where: { id },
      data: {
        ...input,
        ...(completing && { completedAt: new Date(), percentage: input.percentage ?? 100 }),
        ...(input.status && input.status !== 'COMPLETED' && { completedAt: null }),
      },
      select: taskSelect,
    });
    await this.audit.record(actor, {
      action: reassigned ? 'task.assigned' : 'task.updated',
      entityType: 'task',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])),
      newValue: input,
    });
    if (reassigned) {
      await notify(this.prisma, {
        organizationId: auth.organizationId,
        userIds: [input.assignedToId],
        exceptUserId: auth.userId,
        type: 'task.assigned',
        title: `Task assigned to you: ${task.title}`,
        link: `/tasks/${id}`,
      });
    }
    return task;
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const task = await this.prisma.task.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.can(auth, 'task.delete', task))) throw new ForbiddenException('You cannot delete this task');
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'task', row: task, label: task.title, deletedById: auth.userId, children: [{ model: 'taskUpdate', rows: await this.prisma.taskUpdate.findMany({ where: { taskId: id } }) }] });
    await this.prisma.task.delete({ where: { id } });
    await this.audit.record(actor, {
      action: 'task.deleted',
      entityType: 'task',
      entityId: id,
      oldValue: { title: task.title },
    });
  }

  /** Daily work update: appends to the task history and moves the task forward. */
  async addUpdate(auth: AuthContext, actor: AuditActor, id: string, input: WorkUpdateInput) {
    const task = await this.prisma.task.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canSubmitUpdate(auth, task))) throw new ForbiddenException('You cannot post updates on this task');
    if (task.status === 'CANCELLED') throw new BadRequestException('This task is cancelled');

    const status: TaskStatus =
      input.status ?? (input.percentage >= 100 ? 'IN_REVIEW' : input.blockers ? 'BLOCKED' : 'IN_PROGRESS');

    const [update] = await this.prisma.$transaction([
      this.prisma.taskUpdate.create({
        data: {
          taskId: id,
          userId: auth.userId,
          percentage: input.percentage,
          summary: input.summary,
          blockers: input.blockers,
          status,
        },
        select: { id: true, percentage: true, summary: true, blockers: true, status: true, createdAt: true },
      }),
      this.prisma.task.update({
        where: { id },
        data: {
          percentage: input.percentage,
          status,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        },
      }),
    ]);
    await this.audit.record(actor, {
      action: 'work_update.submitted',
      entityType: 'task',
      entityId: id,
      oldValue: { percentage: task.percentage, status: task.status },
      newValue: { percentage: input.percentage, status, summary: input.summary, blockers: input.blockers },
    });
    return update;
  }

  /** Lead review of a submitted update (arch doc §26). */
  async review(auth: AuthContext, actor: AuditActor, id: string, updateId: string, input: ReviewInput) {
    const task = await this.prisma.task.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'work_update.review', {
      teamId: task.teamId ?? undefined,
      eventId: task.eventId ?? undefined,
    });
    const update = await this.prisma.taskUpdate.findFirstOrThrow({ where: { id: updateId, taskId: id } });

    const accepted = input.decision === 'ACCEPT';
    const status: TaskStatus = accepted
      ? update.percentage >= 100
        ? 'COMPLETED'
        : task.status
      : 'IN_PROGRESS';

    await this.prisma.$transaction([
      this.prisma.taskUpdate.update({
        where: { id: updateId },
        data: { reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: input.note },
      }),
      this.prisma.task.update({
        where: { id },
        data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
      }),
    ]);
    await this.audit.record(actor, {
      action: accepted ? 'work_update.accepted' : 'work_update.changes_requested',
      entityType: 'task',
      entityId: id,
      oldValue: { status: task.status },
      newValue: { status, note: input.note, updateId },
    });
    return { taskId: id, updateId, status };
  }

  /** Progress rollup for a person, team or event (arch doc §20). */
  async stats(auth: AuthContext, filter: { teamId?: string; eventId?: string; assignedToId?: string }) {
    const where = {
      organizationId: auth.organizationId,
      ...(filter.teamId && { teamId: filter.teamId }),
      ...(filter.eventId && { eventId: filter.eventId }),
      ...(filter.assignedToId && { assignedToId: filter.assignedToId }),
    };
    const [byStatus, aggregate, overdue] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.task.aggregate({ where, _avg: { percentage: true }, _count: true }),
      this.prisma.task.count({
        where: { ...where, dueDate: { lt: new Date() }, status: { in: [...OPEN_STATUSES] } },
      }),
    ]);

    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Partial<Record<TaskStatus, number>>;
    const total = aggregate._count;
    const completed = counts.COMPLETED ?? 0;
    return {
      total,
      completed,
      open: OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0),
      overdue,
      inReview: counts.IN_REVIEW ?? 0,
      blocked: counts.BLOCKED ?? 0,
      byStatus: counts,
      /** Average reported progress across all tasks in scope. */
      progress: Math.round(aggregate._avg.percentage ?? 0),
      completionRate: total ? Math.round((completed / total) * 100) : 0,
    };
  }

  // ── access helpers ───────────────────────────────────────────

  private can(auth: AuthContext, action: string, task: TaskRef) {
    return this.permissions.can(auth, action, {
      teamId: task.teamId ?? undefined,
      eventId: task.eventId ?? undefined,
    });
  }

  /** Own work is always visible; everything else goes through task.view. */
  private async canSee(auth: AuthContext, task: TaskRef) {
    if (task.assignedToId === auth.userId || task.createdById === auth.userId) return true;
    return this.can(auth, 'task.view', task);
  }

  private async canManage(auth: AuthContext, task: TaskRef) {
    if (task.createdById === auth.userId) return true;
    return this.can(auth, 'task.update', task);
  }

  private async canSubmitUpdate(auth: AuthContext, task: TaskRef) {
    if (!(await this.permissions.can(auth, 'work_update.create'))) return false;
    if (task.assignedToId === auth.userId) return true;
    return this.can(auth, 'task.update', task);
  }

  private async assertReferences(auth: AuthContext, input: Partial<CreateTaskInput>, selfId?: string) {
    const organizationId = auth.organizationId;
    if (input.parentTaskId) {
      if (input.parentTaskId === selfId) throw new BadRequestException('A task cannot be its own parent');
      if (!(await this.prisma.task.count({ where: { id: input.parentTaskId, organizationId } }))) {
        throw new BadRequestException('Parent task not found');
      }
    }
    if (input.teamId && !(await this.prisma.team.count({ where: { id: input.teamId, organizationId } }))) {
      throw new BadRequestException('Team not found');
    }
    if (input.eventId && !(await this.prisma.event.count({ where: { id: input.eventId, organizationId } }))) {
      throw new BadRequestException('Event not found');
    }
    if (
      input.assignedToId &&
      !(await this.prisma.user.count({
        where: { id: input.assignedToId, organizationId, status: { not: 'DISABLED' } },
      }))
    ) {
      throw new BadRequestException('Assignee not found');
    }
  }
}

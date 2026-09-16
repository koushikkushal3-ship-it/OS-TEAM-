import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditActor } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { type AttendancePolicy, computeAttendance, readPolicy } from './attendance.js';
import type {
  ActionItemInput,
  AttendanceOverrideInput,
  AttendanceStatsInput,
  CreateMeetingInput,
  DecisionInput,
  ListMeetingsInput,
  ParticipantInput,
  SessionInputDto,
  UpdateMeetingInput,
} from './dto.js';
import { notify, recycle } from '../platform/records.js';

const userRef = { select: { id: true, name: true, email: true, avatarUrl: true } } as const;

const meetingSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  status: true,
  provider: true,
  providerSpaceId: true,
  joinUrl: true,
  location: true,
  scheduledStart: true,
  scheduledEnd: true,
  startedAt: true,
  endedAt: true,
  teamId: true,
  eventId: true,
  createdById: true,
  team: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { participants: true, actionItems: true, decisions: true } },
} as const;

type MeetingRef = { teamId: string | null; eventId: string | null; createdById?: string | null };

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  // ── policy ───────────────────────────────────────────────────

  async policy(): Promise<AttendancePolicy> {
    const attendanceModule = await this.prisma.module.findUnique({ where: { key: 'attendance' } });
    return readPolicy(attendanceModule?.config);
  }

  // ── meetings ─────────────────────────────────────────────────

  async list(auth: AuthContext, q: ListMeetingsInput) {
    const broadView = await this.permissions.can(auth, 'meeting.view');
    const scoped =
      q.scope === 'mine'
        ? { participants: { some: { userId: auth.userId } } }
        : q.scope === 'team'
          ? { teamId: q.teamId }
          : q.scope === 'event'
            ? { eventId: q.eventId }
            : {};

    const rows = await this.prisma.meeting.findMany({
      where: {
        organizationId: auth.organizationId,
        ...scoped,
        ...(q.teamId && { teamId: q.teamId }),
        ...(q.eventId && { eventId: q.eventId }),
        ...(q.status && { status: q.status }),
        ...(q.upcoming && { scheduledStart: { gte: new Date() }, status: { in: ['SCHEDULED', 'LIVE'] } }),
        ...(!broadView && {
          OR: [
            { participants: { some: { userId: auth.userId } } },
            { createdById: auth.userId },
            { teamId: { in: auth.teamIds } },
          ],
        }),
      },
      orderBy: { scheduledStart: q.upcoming ? 'asc' : 'desc' },
      take: q.limit,
      select: meetingSelect,
    });

    const visible = [];
    for (const m of rows) if (await this.canSee(auth, m)) visible.push(m);
    return visible;
  }

  async get(auth: AuthContext, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organizationId: auth.organizationId },
      select: {
        ...meetingSelect,
        agenda: true,
        notes: true,
        participants: {
          orderBy: { role: 'asc' },
          select: {
            role: true,
            status: true,
            statusManual: true,
            firstJoinAt: true,
            lastLeaveAt: true,
            minutes: true,
            note: true,
            user: userRef,
          },
        },
        sessions: {
          orderBy: { joinedAt: 'asc' },
          select: { id: true, joinedAt: true, leftAt: true, source: true, user: { select: { id: true, name: true } } },
        },
        decisions: { orderBy: { createdAt: 'asc' }, select: { id: true, text: true, createdAt: true, decidedBy: { select: { id: true, name: true } } } },
        actionItems: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            text: true,
            dueDate: true,
            createdAt: true,
            owner: { select: { id: true, name: true } },
            task: { select: { id: true, title: true, status: true, percentage: true } },
          },
        },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (!(await this.canSee(auth, meeting))) throw new ForbiddenException('You cannot view this meeting');

    const [canManage, canEnd, canJoin] = await Promise.all([
      this.canManage(auth, meeting),
      this.can(auth, 'meeting.end', meeting),
      this.can(auth, 'meeting.join', meeting),
    ]);
    return {
      ...meeting,
      isParticipant: meeting.participants.some((p) => p.user.id === auth.userId),
      capabilities: { canManage, canEnd, canJoin, canViewAttendance: await this.can(auth, 'attendance.view', meeting) },
    };
  }

  async create(auth: AuthContext, actor: AuditActor, input: CreateMeetingInput) {
    const target = { teamId: input.teamId ?? undefined, eventId: input.eventId ?? undefined };
    await this.permissions.assert(auth, 'meeting.create', target);
    await this.assertReferences(auth, input);

    const { participantIds, ...fields } = input;
    const participants = [...new Set([auth.userId, ...participantIds])];

    const meeting = await this.prisma.meeting.create({
      data: {
        ...fields,
        organizationId: auth.organizationId,
        createdById: auth.userId,
        provider: input.joinUrl ? 'GOOGLE_MEET_LINK' : 'MANUAL',
        participants: {
          create: participants.map((userId) => ({ userId, role: userId === auth.userId ? 'HOST' : 'REQUIRED' })),
        },
      },
      select: meetingSelect,
    });
    await this.audit.record(actor, {
      action: 'meeting.created',
      entityType: 'meeting',
      entityId: meeting.id,
      newValue: { title: meeting.title, type: meeting.type, scheduledStart: meeting.scheduledStart, participants: participants.length },
    });
    await notify(this.prisma, {
      organizationId: auth.organizationId,
      userIds: participants,
      exceptUserId: auth.userId,
      type: 'meeting.invited',
      title: `Meeting: ${meeting.title}`,
      body: new Date(meeting.scheduledStart).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      link: `/meetings/${meeting.id}`,
    });
    return meeting;
  }

  async update(auth: AuthContext, actor: AuditActor, id: string, input: UpdateMeetingInput) {
    const before = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, before))) throw new ForbiddenException('You cannot edit this meeting');

    const start = input.scheduledStart ?? before.scheduledStart;
    const end = input.scheduledEnd ?? before.scheduledEnd;
    if (end <= start) throw new BadRequestException('The meeting must end after it starts');
    await this.assertReferences(auth, input);

    const meeting = await this.prisma.meeting.update({
      where: { id },
      data: { ...input, ...(input.joinUrl && before.provider === 'MANUAL' ? { provider: 'GOOGLE_MEET_LINK' as const } : {}) },
      select: meetingSelect,
    });
    await this.audit.record(actor, {
      action: input.notes !== undefined ? 'meeting.notes_updated' : 'meeting.updated',
      entityType: 'meeting',
      entityId: id,
      oldValue: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])),
      newValue: input,
    });
    return meeting;
  }

  async remove(auth: AuthContext, actor: AuditActor, id: string) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, meeting))) throw new ForbiddenException('You cannot delete this meeting');
    await recycle(this.prisma, { organizationId: auth.organizationId, entityType: 'meeting', row: meeting, label: meeting.title, deletedById: auth.userId, children: [
      { model: 'meetingParticipant', rows: await this.prisma.meetingParticipant.findMany({ where: { meetingId: id } }) },
      { model: 'participantSession', rows: await this.prisma.participantSession.findMany({ where: { meetingId: id } }) },
      { model: 'meetingDecision', rows: await this.prisma.meetingDecision.findMany({ where: { meetingId: id } }) },
      { model: 'meetingActionItem', rows: await this.prisma.meetingActionItem.findMany({ where: { meetingId: id } }) },
    ] });
    await this.prisma.meeting.delete({ where: { id } });
    await this.audit.record(actor, { action: 'meeting.deleted', entityType: 'meeting', entityId: id, oldValue: { title: meeting.title } });
  }

  /** Start the meeting: everyone joining from now on is recorded. */
  async start(auth: AuthContext, actor: AuditActor, id: string) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, meeting))) throw new ForbiddenException('You cannot start this meeting');
    if (meeting.status === 'ENDED') throw new BadRequestException('This meeting has already ended');

    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { status: 'LIVE', startedAt: meeting.startedAt ?? new Date() },
      select: meetingSelect,
    });
    await this.audit.record(actor, { action: 'meeting.started', entityType: 'meeting', entityId: id, newValue: { startedAt: updated.startedAt } });
    return updated;
  }

  /** End the meeting, close open sessions and freeze attendance. */
  async end(auth: AuthContext, actor: AuditActor, id: string) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'meeting.end', { teamId: meeting.teamId ?? undefined, eventId: meeting.eventId ?? undefined });

    const endedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.participantSession.updateMany({ where: { meetingId: id, leftAt: null }, data: { leftAt: endedAt } }),
      this.prisma.meeting.update({ where: { id }, data: { status: 'ENDED', endedAt, startedAt: meeting.startedAt ?? meeting.scheduledStart } }),
    ]);
    const attendance = await this.recalculate(id);
    await this.audit.record(actor, {
      action: 'meeting.ended',
      entityType: 'meeting',
      entityId: id,
      newValue: { endedAt, attendance: attendance.map((a) => ({ userId: a.userId, status: a.status, minutes: a.minutes })) },
    });
    return this.get(auth, id);
  }

  // ── participants ─────────────────────────────────────────────

  async setParticipant(auth: AuthContext, actor: AuditActor, id: string, input: ParticipantInput) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, meeting))) throw new ForbiddenException('You cannot manage participants');
    await this.assertUser(auth, input.userId);

    const participant = await this.prisma.meetingParticipant.upsert({
      where: { meetingId_userId: { meetingId: id, userId: input.userId } },
      create: { meetingId: id, userId: input.userId, role: input.role },
      update: { role: input.role },
      select: { role: true, status: true, user: userRef },
    });
    await this.audit.record(actor, { action: 'meeting.participant_set', entityType: 'meeting', entityId: id, newValue: input });
    return participant;
  }

  async removeParticipant(auth: AuthContext, actor: AuditActor, id: string, userId: string) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, meeting))) throw new ForbiddenException('You cannot manage participants');
    await this.prisma.meetingParticipant.delete({ where: { meetingId_userId: { meetingId: id, userId } } });
    await this.audit.record(actor, { action: 'meeting.participant_removed', entityType: 'meeting', entityId: id, oldValue: { userId } });
  }

  // ── attendance ───────────────────────────────────────────────

  /** Records that the current user joined through TEAM OS. */
  async join(auth: AuthContext, actor: AuditActor, id: string) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'meeting.join', { teamId: meeting.teamId ?? undefined, eventId: meeting.eventId ?? undefined });
    if (meeting.status === 'CANCELLED') throw new BadRequestException('This meeting was cancelled');

    const open = await this.prisma.participantSession.findFirst({ where: { meetingId: id, userId: auth.userId, leftAt: null } });
    if (!open) {
      await this.prisma.participantSession.create({
        data: { meetingId: id, userId: auth.userId, joinedAt: new Date(), source: 'SELF' },
      });
      await this.prisma.meetingParticipant.upsert({
        where: { meetingId_userId: { meetingId: id, userId: auth.userId } },
        create: { meetingId: id, userId: auth.userId, role: 'REQUIRED' },
        update: {},
      });
      await this.audit.record(actor, { action: 'attendance.join', entityType: 'meeting', entityId: id });
    }
    if (meeting.status === 'SCHEDULED') {
      await this.prisma.meeting.update({ where: { id }, data: { status: 'LIVE', startedAt: meeting.startedAt ?? new Date() } });
    }
    await this.recalculate(id);
    return { joinUrl: meeting.joinUrl, location: meeting.location };
  }

  async leave(auth: AuthContext, actor: AuditActor, id: string) {
    const open = await this.prisma.participantSession.findFirst({
      where: { meetingId: id, userId: auth.userId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });
    if (open) {
      await this.prisma.participantSession.update({ where: { id: open.id }, data: { leftAt: new Date() } });
      await this.audit.record(actor, { action: 'attendance.leave', entityType: 'meeting', entityId: id });
    }
    return this.recalculate(id);
  }

  /** Lead records a join/leave pair by hand (physical meetings, provider gaps). */
  async addSession(auth: AuthContext, actor: AuditActor, id: string, input: SessionInputDto) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'attendance.manage', { teamId: meeting.teamId ?? undefined, eventId: meeting.eventId ?? undefined });
    const userId = input.userId ?? auth.userId;
    if (input.leftAt && input.leftAt <= input.joinedAt) throw new BadRequestException('Leave time must be after join time');
    await this.assertUser(auth, userId);

    await this.prisma.$transaction([
      this.prisma.meetingParticipant.upsert({
        where: { meetingId_userId: { meetingId: id, userId } },
        create: { meetingId: id, userId, role: 'REQUIRED' },
        update: {},
      }),
      this.prisma.participantSession.create({
        data: { meetingId: id, userId, joinedAt: input.joinedAt, leftAt: input.leftAt ?? null, source: 'MANUAL' },
      }),
    ]);
    await this.audit.record(actor, { action: 'attendance.session_added', entityType: 'meeting', entityId: id, newValue: { userId, ...input } });
    return this.recalculate(id);
  }

  /** Manual override of a derived status (arch doc §27: thresholds are policy, not judgement). */
  async overrideAttendance(auth: AuthContext, actor: AuditActor, id: string, userId: string, input: AttendanceOverrideInput) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    await this.permissions.assert(auth, 'attendance.manage', { teamId: meeting.teamId ?? undefined, eventId: meeting.eventId ?? undefined });

    const before = await this.prisma.meetingParticipant.findUniqueOrThrow({ where: { meetingId_userId: { meetingId: id, userId } } });
    const participant = await this.prisma.meetingParticipant.update({
      where: { meetingId_userId: { meetingId: id, userId } },
      data: { status: input.status, statusManual: true, note: input.note },
      select: { role: true, status: true, statusManual: true, note: true, minutes: true, user: userRef },
    });
    await this.audit.record(actor, {
      action: 'attendance.overridden',
      entityType: 'meeting',
      entityId: id,
      oldValue: { userId, status: before.status, derived: true },
      newValue: { userId, status: input.status, note: input.note },
    });
    return participant;
  }

  /** Recomputes derived attendance for every participant; manual overrides are kept. */
  async recalculate(meetingId: string) {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: {
        scheduledStart: true,
        scheduledEnd: true,
        startedAt: true,
        endedAt: true,
        participants: { select: { userId: true, statusManual: true } },
        sessions: { select: { userId: true, joinedAt: true, leftAt: true } },
      },
    });
    const policy = await this.policy();

    const results = [];
    for (const participant of meeting.participants) {
      const sessions = meeting.sessions.filter((s) => s.userId === participant.userId);
      const result = computeAttendance(sessions, meeting, policy);
      await this.prisma.meetingParticipant.update({
        where: { meetingId_userId: { meetingId, userId: participant.userId } },
        data: {
          minutes: result.minutes,
          firstJoinAt: result.firstJoinAt,
          lastLeaveAt: result.lastLeaveAt,
          ...(participant.statusManual ? {} : { status: result.status }),
        },
      });
      results.push({ userId: participant.userId, ...result });
    }
    return results;
  }

  /** Attendance history for a person, team or event. */
  async attendanceStats(auth: AuthContext, q: AttendanceStatsInput) {
    const userId = q.userId ?? auth.userId;
    // Own attendance is always readable. Another person's needs attendance.manage
    // (leads and operations); a team view needs membership or the same permission.
    if (userId !== auth.userId) {
      await this.permissions.assert(auth, 'attendance.manage', { teamId: q.teamId, eventId: q.eventId });
    } else if (q.teamId && !auth.teamIds.includes(q.teamId)) {
      await this.permissions.assert(auth, 'attendance.manage', { teamId: q.teamId });
    } else if (q.teamId) {
      await this.permissions.assert(auth, 'attendance.view', { teamId: q.teamId });
    }

    const where = {
      meeting: {
        organizationId: auth.organizationId,
        status: 'ENDED' as const,
        ...(q.teamId && { teamId: q.teamId }),
        ...(q.eventId && { eventId: q.eventId }),
        ...((q.from || q.to) && { scheduledStart: { gte: q.from, lte: q.to } }),
      },
      ...(q.userId !== undefined || !q.teamId ? { userId } : {}),
    };

    const rows = await this.prisma.meetingParticipant.findMany({
      where,
      select: {
        status: true,
        minutes: true,
        user: { select: { id: true, name: true } },
        meeting: { select: { id: true, title: true, scheduledStart: true, team: { select: { id: true, name: true } } } },
      },
      orderBy: { meeting: { scheduledStart: 'desc' } },
      take: 200,
    });

    const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    const attended = (counts.PRESENT ?? 0) + (counts.LATE ?? 0) + (counts.PARTIAL ?? 0);
    return {
      meetings: rows.length,
      counts,
      minutes: rows.reduce((n, r) => n + r.minutes, 0),
      /** Share of ended meetings the person actually attended in some form. */
      attendanceRate: rows.length ? Math.round((attended / rows.length) * 100) : 0,
      recent: rows.slice(0, 25),
    };
  }

  // ── notes, decisions, action items ───────────────────────────

  async addDecision(auth: AuthContext, actor: AuditActor, id: string, input: DecisionInput) {
    const meeting = await this.assertManageable(auth, id);
    const decision = await this.prisma.meetingDecision.create({
      data: { meetingId: meeting.id, text: input.text, decidedById: auth.userId },
      select: { id: true, text: true, createdAt: true, decidedBy: { select: { id: true, name: true } } },
    });
    await this.audit.record(actor, { action: 'meeting.decision_recorded', entityType: 'meeting', entityId: id, newValue: { text: input.text } });
    return decision;
  }

  async removeDecision(auth: AuthContext, actor: AuditActor, id: string, decisionId: string) {
    await this.assertManageable(auth, id);
    const before = await this.prisma.meetingDecision.findFirstOrThrow({ where: { id: decisionId, meetingId: id } });
    await this.prisma.meetingDecision.delete({ where: { id: decisionId } });
    await this.audit.record(actor, { action: 'meeting.decision_removed', entityType: 'meeting', entityId: id, oldValue: { text: before.text } });
  }

  /** Action item, optionally created as a real task for its owner (arch doc §26). */
  async addActionItem(auth: AuthContext, actor: AuditActor, id: string, input: ActionItemInput) {
    const meeting = await this.assertManageable(auth, id);
    if (input.ownerId) await this.assertUser(auth, input.ownerId);

    let taskId: string | null = null;
    if (input.createTask && input.ownerId && (await this.permissions.can(auth, 'task.create', { teamId: meeting.teamId ?? undefined, eventId: meeting.eventId ?? undefined }))) {
      const task = await this.prisma.task.create({
        data: {
          organizationId: auth.organizationId,
          teamId: meeting.teamId,
          eventId: meeting.eventId,
          title: input.text,
          description: `From meeting: ${meeting.title}`,
          createdById: auth.userId,
          assignedToId: input.ownerId,
          dueDate: input.dueDate ?? null,
          status: 'ASSIGNED',
        },
      });
      taskId = task.id;
      await this.audit.record(actor, {
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        newValue: { title: task.title, fromMeeting: meeting.id, assignedToId: input.ownerId },
      });
    }

    const action = await this.prisma.meetingActionItem.create({
      data: { meetingId: id, text: input.text, ownerId: input.ownerId ?? null, dueDate: input.dueDate ?? null, taskId },
      select: {
        id: true,
        text: true,
        dueDate: true,
        createdAt: true,
        owner: { select: { id: true, name: true } },
        task: { select: { id: true, title: true, status: true, percentage: true } },
      },
    });
    await this.audit.record(actor, {
      action: 'meeting.action_item_added',
      entityType: 'meeting',
      entityId: id,
      newValue: { text: input.text, ownerId: input.ownerId, taskId },
    });
    return action;
  }

  async removeActionItem(auth: AuthContext, actor: AuditActor, id: string, actionId: string) {
    await this.assertManageable(auth, id);
    const before = await this.prisma.meetingActionItem.findFirstOrThrow({ where: { id: actionId, meetingId: id } });
    await this.prisma.meetingActionItem.delete({ where: { id: actionId } });
    await this.audit.record(actor, {
      action: 'meeting.action_item_removed',
      entityType: 'meeting',
      entityId: id,
      oldValue: { text: before.text, taskId: before.taskId },
    });
  }

  // ── helpers ──────────────────────────────────────────────────

  private can(auth: AuthContext, action: string, meeting: MeetingRef) {
    return this.permissions.can(auth, action, { teamId: meeting.teamId ?? undefined, eventId: meeting.eventId ?? undefined });
  }

  /** Creator and invited participants always see the meeting; others need meeting.view. */
  private async canSee(auth: AuthContext, meeting: MeetingRef & { id?: string; participants?: { user: { id: string } }[] }) {
    if (meeting.createdById === auth.userId) return true;
    if (meeting.participants?.some((p) => p.user.id === auth.userId)) return true;
    if (meeting.id) {
      const invited = await this.prisma.meetingParticipant.count({ where: { meetingId: meeting.id, userId: auth.userId } });
      if (invited) return true;
    }
    return this.can(auth, 'meeting.view', meeting);
  }

  private async canManage(auth: AuthContext, meeting: MeetingRef) {
    if (meeting.createdById === auth.userId) return true;
    return this.can(auth, 'meeting.manage', meeting);
  }

  private async assertManageable(auth: AuthContext, id: string) {
    const meeting = await this.prisma.meeting.findFirstOrThrow({ where: { id, organizationId: auth.organizationId } });
    if (!(await this.canManage(auth, meeting))) throw new ForbiddenException('You cannot change this meeting record');
    return meeting;
  }

  private async assertUser(auth: AuthContext, userId: string) {
    const n = await this.prisma.user.count({ where: { id: userId, organizationId: auth.organizationId, status: { not: 'DISABLED' } } });
    if (!n) throw new BadRequestException('Person not found');
  }

  private async assertReferences(auth: AuthContext, input: { teamId?: string | null; eventId?: string | null; participantIds?: string[] }) {
    const organizationId = auth.organizationId;
    if (input.teamId && !(await this.prisma.team.count({ where: { id: input.teamId, organizationId } }))) {
      throw new BadRequestException('Team not found');
    }
    if (input.eventId && !(await this.prisma.event.count({ where: { id: input.eventId, organizationId } }))) {
      throw new BadRequestException('Event not found');
    }
    if (input.participantIds?.length) {
      const ids = [...new Set(input.participantIds)];
      const n = await this.prisma.user.count({ where: { id: { in: ids }, organizationId, status: { not: 'DISABLED' } } });
      if (n !== ids.length) throw new BadRequestException('One or more participants were not found');
    }
  }
}

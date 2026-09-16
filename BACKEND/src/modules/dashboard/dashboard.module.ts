import { Controller, Get, Module, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionService } from '../permissions/permission.service.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { MeetingsService } from '../meetings/meetings.service.js';
import { TasksService } from '../tasks/tasks.service.js';

/** Role-aware Home / Workspace summary (Master Plan §5, arch doc §14). */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly tasks: TasksService,
    private readonly meetings: MeetingsService,
  ) {}

  @Get('summary')
  async summary(@Req() req: AuthenticatedRequest) {
    const { auth } = req;
    const organizationId = req.user.organizationId;

    const [memberships, isAdmin, canManageSomeTeam] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { userId: auth.userId, team: { isActive: true } },
        select: {
          memberRole: true,
          team: { select: { id: true, name: true, _count: { select: { members: true, events: true } } } },
        },
      }),
      this.permissions.can(auth, 'user.create'),
      this.permissions.can(auth, 'team.manage_members'),
    ]);
    const leadTeams = memberships.filter((m) => m.memberRole !== 'MEMBER');
    const kind = isAdmin ? 'admin' : leadTeams.length > 0 || canManageSomeTeam ? 'lead' : 'member';

    const eventWhere = {
      organizationId,
      status: { in: ['PLANNING' as const, 'ACTIVE' as const] },
      ...(!isAdmin && {
        OR: [{ id: { in: auth.eventIds } }, { teams: { some: { teamId: { in: auth.teamIds } } } }],
      }),
    };

    // Teams whose progress this person should see on Home: their own teams for a
    // lead, every team they belong to for an admin.
    const progressTeams = isAdmin ? memberships : leadTeams;

    const [myWork, dueSoon, nextMeetings, myAttendance, activeEvents, organization, teamProgress] = await Promise.all([
      this.tasks.stats(auth, { assignedToId: auth.userId }),
      this.prisma.task.findMany({
        where: {
          organizationId,
          assignedToId: auth.userId,
          status: { in: ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] },
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          percentage: true,
          dueDate: true,
          team: { select: { id: true, name: true } },
          event: { select: { id: true, name: true } },
        },
      }),
      this.prisma.meeting.findMany({
        where: {
          organizationId,
          status: { in: ['SCHEDULED', 'LIVE'] },
          scheduledEnd: { gte: new Date() },
          participants: { some: { userId: auth.userId } },
        },
        orderBy: { scheduledStart: 'asc' },
        take: 4,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          joinUrl: true,
          location: true,
          team: { select: { id: true, name: true } },
          event: { select: { id: true, name: true } },
        },
      }),
      this.meetings.attendanceStats(auth, {}),
      this.prisma.event.findMany({
        where: eventWhere,
        orderBy: { startDate: { sort: 'asc', nulls: 'last' } },
        take: 6,
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          venue: true,
          _count: { select: { teams: true } },
        },
      }),
      isAdmin
        ? Promise.all([
            this.prisma.user.count({ where: { organizationId, status: 'ACTIVE' } }),
            this.prisma.user.count({ where: { organizationId, status: 'INVITED' } }),
            this.prisma.team.count({ where: { organizationId, isActive: true } }),
            this.prisma.event.count({ where: { organizationId, status: { in: ['PLANNING', 'ACTIVE'] } } }),
            this.tasks.stats(auth, {}),
          ]).then(([activeUsers, invitedUsers, teams, events, work]) => ({
            activeUsers,
            invitedUsers,
            teams,
            events,
            work,
          }))
        : null,
      Promise.all(
        progressTeams.map(async (m) => ({
          id: m.team.id,
          name: m.team.name,
          memberRole: m.memberRole,
          memberCount: m.team._count.members,
          stats: await this.tasks.stats(auth, { teamId: m.team.id }),
        })),
      ),
    ]);

    return {
      kind,
      myTeams: memberships.map((m) => ({ ...m.team, memberRole: m.memberRole })),
      leadTeams: leadTeams.map((m) => ({ ...m.team, memberRole: m.memberRole })),
      activeEvents,
      organization,
      myWork,
      dueSoon,
      nextMeetings,
      myAttendance,
      teamProgress,
      // Filled in by later phases.
      upcoming: { notifications: null, approvals: null },
    };
  }
}

@Module({ imports: [TasksModule, MeetingsModule], controllers: [DashboardController] })
export class DashboardModule {}

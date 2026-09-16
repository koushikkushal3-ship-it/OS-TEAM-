import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  type AuthContext,
  type Decision,
  type PermissionTarget,
  type PolicySnapshot,
  effectivePermissions,
  evaluate,
  visibleModules,
} from './permission-engine.js';

const POLICY_TTL_MS = 30_000;

/**
 * The single permission service every protected operation goes through (arch doc §9):
 * `PermissionService.can(auth, 'finance.approve', { eventId })`.
 */
@Injectable()
export class PermissionService {
  private policies = new Map<string, { snapshot: PolicySnapshot; loadedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async can(ctx: AuthContext, action: string, target?: PermissionTarget): Promise<boolean> {
    return (await this.explain(ctx, action, target)).allowed;
  }

  async explain(ctx: AuthContext, action: string, target?: PermissionTarget): Promise<Decision> {
    return evaluate(ctx, action, await this.policy(ctx.organizationId), target);
  }

  async assert(ctx: AuthContext, action: string, target?: PermissionTarget): Promise<void> {
    const decision = await this.explain(ctx, action, target);
    if (!decision.allowed) {
      throw new ForbiddenException({ message: 'You do not have permission for this action', action });
    }
  }

  async effective(ctx: AuthContext): Promise<string[]> {
    return effectivePermissions(ctx, await this.policy(ctx.organizationId));
  }

  /** Modules one person can open — what navigation is built from. */
  async visibleModules(ctx: AuthContext): Promise<string[]> {
    return visibleModules(ctx, await this.policy(ctx.organizationId));
  }

  async enabledModules(organizationId: string): Promise<string[]> {
    const policy = await this.policy(organizationId);
    return [...policy.modules].filter(([, status]) => status === 'ENABLED').map(([key]) => key);
  }

  /** Modules scheduled for a later phase — shown as "coming soon" in navigation. */
  async plannedModules(): Promise<{ key: string; name: string; phase: number }[]> {
    return this.prisma.module.findMany({
      where: { status: 'PLANNED' },
      select: { key: true, name: true, phase: true },
      orderBy: { phase: 'asc' },
    });
  }

  /**
   * Active people who can perform `action` somewhere — used to decide who to notify.
   * Candidates come from role grants and USER allow-overrides, then each is checked by the engine.
   */
  async usersWith(organizationId: string, action: string): Promise<string[]> {
    const prefix = `${action.split('.')[0]}.*`;
    const candidates = await this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        roles: { some: { role: { isActive: true, OR: [{ isMasterAdmin: true }, { permissions: { some: { permissionKey: { in: [action, prefix] } } } }] } } },
      },
      select: { id: true },
    });
    const overrides = await this.prisma.permissionOverride.findMany({
      where: { organizationId, scopeType: 'USER', effect: 'ALLOW', permissionKey: { in: [action, prefix, '*'] } },
      select: { scopeId: true },
    });
    const ids = new Set([...candidates.map((c) => c.id), ...overrides.map((o) => o.scopeId)]);
    const allowed: string[] = [];
    for (const id of ids) {
      const ctx = await this.buildContext(id, { id: 'notify', privilegedUntil: null });
      if (ctx.organizationId === organizationId && (await this.can(ctx, action))) allowed.push(id);
    }
    return allowed;
  }

  /** Call after any change to roles, permissions, overrides or modules. */
  invalidate(organizationId?: string) {
    if (organizationId) this.policies.delete(organizationId);
    else this.policies.clear();
  }

  async buildContext(
    userId: string,
    session: { id: string; privilegedUntil: Date | null },
  ): Promise<AuthContext> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
        departmentId: true,
        roles: {
          where: { role: { isActive: true } },
          select: {
            scopeType: true,
            scopeId: true,
            role: {
              select: {
                id: true,
                key: true,
                name: true,
                isMasterAdmin: true,
                permissions: { select: { permissionKey: true } },
              },
            },
          },
        },
        teamMemberships: { where: { team: { isActive: true } }, select: { teamId: true } },
        eventMembers: { select: { eventId: true } },
      },
    });

    const roles = user.roles.map((ur) => ({
      roleId: ur.role.id,
      key: ur.role.key,
      name: ur.role.name,
      scopeType: ur.scopeType,
      scopeId: ur.scopeId,
      isMasterAdmin: ur.role.isMasterAdmin,
      permissions: new Set(ur.role.permissions.map((p) => p.permissionKey)),
    }));
    const hasMasterRole = roles.some((r) => r.isMasterAdmin);

    return {
      userId: user.id,
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      sessionId: session.id,
      hasMasterRole,
      privileged: hasMasterRole && !!session.privilegedUntil && session.privilegedUntil > new Date(),
      roles,
      teamIds: user.teamMemberships.map((m) => m.teamId),
      eventIds: user.eventMembers.map((m) => m.eventId),
    };
  }

  private async policy(organizationId: string): Promise<PolicySnapshot> {
    const cached = this.policies.get(organizationId);
    if (cached && Date.now() - cached.loadedAt < POLICY_TTL_MS) return cached.snapshot;

    const [permissions, modules, overrides] = await Promise.all([
      this.prisma.permission.findMany({ select: { key: true, moduleKey: true } }),
      this.prisma.module.findMany({ select: { key: true, status: true } }),
      this.prisma.permissionOverride.findMany({
        // Temporary access simply stops counting once it expires.
        where: { organizationId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { id: true, scopeType: true, scopeId: true, permissionKey: true, effect: true },
      }),
    ]);

    const snapshot: PolicySnapshot = {
      permissions: new Map(permissions.map((p) => [p.key, p.moduleKey])),
      modules: new Map(modules.map((m) => [m.key, m.status])),
      overrides,
    };
    this.policies.set(organizationId, { snapshot, loadedAt: Date.now() });
    return snapshot;
  }
}

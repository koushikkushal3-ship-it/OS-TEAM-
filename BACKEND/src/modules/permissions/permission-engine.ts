/**
 * Pure permission evaluation (arch doc §7–10). No I/O — PermissionService loads
 * the user context + policy snapshot and delegates here, which keeps every
 * module's authorization consistent and unit-testable.
 */

export type RoleScopeType = 'ORGANIZATION' | 'DEPARTMENT' | 'TEAM' | 'EVENT';
export type OverrideScopeType =
  | 'GLOBAL'
  | 'ORGANIZATION'
  | 'DEPARTMENT'
  | 'TEAM'
  | 'EVENT'
  | 'ROLE'
  | 'USER';

export interface ContextRole {
  roleId: string;
  key: string;
  name: string;
  scopeType: RoleScopeType;
  scopeId: string | null;
  isMasterAdmin: boolean;
  permissions: ReadonlySet<string>;
}

export interface AuthContext {
  userId: string;
  organizationId: string;
  departmentId: string | null;
  sessionId: string;
  /** Holds a Master Admin role (eligible for the gateway). */
  hasMasterRole: boolean;
  /** Master role AND an active privileged session (passed gateway + MFA). */
  privileged: boolean;
  roles: ContextRole[];
  teamIds: string[];
  eventIds: string[];
}

export interface PolicyOverride {
  id: string;
  scopeType: OverrideScopeType;
  scopeId: string;
  permissionKey: string;
  effect: 'ALLOW' | 'DENY';
}

export interface PolicySnapshot {
  /** permission key → module key */
  permissions: ReadonlyMap<string, string>;
  /** module key → status */
  modules: ReadonlyMap<string, 'ENABLED' | 'DISABLED' | 'PLANNED'>;
  overrides: readonly PolicyOverride[];
}

/** The resource/context an action is performed on. Omit for "anywhere I have it". */
export interface PermissionTarget {
  teamId?: string;
  eventId?: string;
  departmentId?: string;
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

const OVERRIDE_ORDER: OverrideScopeType[] = [
  'GLOBAL',
  'ORGANIZATION',
  'DEPARTMENT',
  'TEAM',
  'EVENT',
  'ROLE',
  'USER',
];

export function keyMatches(pattern: string, action: string): boolean {
  if (pattern === '*' || pattern === action) return true;
  if (pattern.endsWith('.*')) return action.startsWith(pattern.slice(0, -1));
  return false;
}

function roleScopeMatches(role: ContextRole, target?: PermissionTarget): boolean {
  switch (role.scopeType) {
    case 'ORGANIZATION':
      return true;
    case 'DEPARTMENT':
      return target?.departmentId === undefined || target.departmentId === role.scopeId;
    case 'TEAM':
      return target?.teamId === undefined || target.teamId === role.scopeId;
    case 'EVENT':
      return target?.eventId === undefined || target.eventId === role.scopeId;
  }
}

/**
 * Department/team/event overrides apply to the target resource when one is
 * given; otherwise to the user's own memberships.
 */
function overrideApplies(o: PolicyOverride, ctx: AuthContext, target?: PermissionTarget): boolean {
  switch (o.scopeType) {
    case 'GLOBAL':
      return true;
    case 'ORGANIZATION':
      return o.scopeId === ctx.organizationId;
    case 'DEPARTMENT':
      return target?.departmentId !== undefined
        ? target.departmentId === o.scopeId
        : ctx.departmentId === o.scopeId;
    case 'TEAM':
      return target?.teamId !== undefined ? target.teamId === o.scopeId : ctx.teamIds.includes(o.scopeId);
    case 'EVENT':
      return target?.eventId !== undefined ? target.eventId === o.scopeId : ctx.eventIds.includes(o.scopeId);
    case 'ROLE':
      return ctx.roles.some((r) => r.roleId === o.scopeId);
    case 'USER':
      return o.scopeId === ctx.userId;
  }
}

export function evaluate(
  ctx: AuthContext,
  action: string,
  policy: PolicySnapshot,
  target?: PermissionTarget,
): Decision {
  const moduleKey = policy.permissions.get(action);
  if (!moduleKey) return { allowed: false, reason: `Unknown permission "${action}"` };

  const status = policy.modules.get(moduleKey);
  if (status !== 'ENABLED') {
    return { allowed: false, reason: `Module "${moduleKey}" is ${status ?? 'missing'}` };
  }

  if (ctx.privileged) return { allowed: true, reason: 'Master Admin privileged session' };

  const grantingRole = ctx.roles.find((r) => r.permissions.has(action) && roleScopeMatches(r, target));
  let decision: Decision = grantingRole
    ? { allowed: true, reason: `Granted by role "${grantingRole.name}" (${grantingRole.scopeType})` }
    : { allowed: false, reason: 'No role grants this permission in this context' };

  // Configuration hierarchy: the most specific level with a matching override wins;
  // DENY beats ALLOW within the same level.
  for (const level of OVERRIDE_ORDER) {
    const matches = policy.overrides.filter(
      (o) => o.scopeType === level && keyMatches(o.permissionKey, action) && overrideApplies(o, ctx, target),
    );
    if (matches.length === 0) continue;
    const deny = matches.find((o) => o.effect === 'DENY');
    decision = deny
      ? { allowed: false, reason: `Denied by ${level} override (${deny.permissionKey})` }
      : { allowed: true, reason: `Allowed by ${level} override (${matches[0].permissionKey})` };
  }

  return decision;
}

/** Every permission key the user holds somewhere (drives frontend navigation). */
export function effectivePermissions(ctx: AuthContext, policy: PolicySnapshot): string[] {
  return [...policy.permissions.keys()].filter((key) => evaluate(ctx, key, policy).allowed).sort();
}

/**
 * Modules this person can actually open: enabled for the organization *and* they hold at
 * least one permission inside it. Navigation is built from this, so denying someone a whole
 * module (a USER override on `finance.*`) removes the menu item instead of leaving a link
 * that leads to a refusal.
 */
export function visibleModules(ctx: AuthContext, policy: PolicySnapshot): string[] {
  const allowed = new Set(effectivePermissions(ctx, policy));
  const usable = new Set<string>();
  for (const [key, moduleKey] of policy.permissions) {
    if (allowed.has(key)) usable.add(moduleKey);
  }
  return [...policy.modules]
    .filter(([key, status]) => status === 'ENABLED' && usable.has(key))
    .map(([key]) => key)
    .sort();
}

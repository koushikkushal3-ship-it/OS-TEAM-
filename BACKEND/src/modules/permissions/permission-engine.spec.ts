import {
  type AuthContext,
  type ContextRole,
  type PolicyOverride,
  type PolicySnapshot,
  evaluate,
  effectivePermissions,
  keyMatches,
  visibleModules,
} from './permission-engine.js';

const ORG = 'org-1';
const CREATIVE_TEAM = 'team-creative';
const TECH_TEAM = 'team-tech';
const SUMMIT = 'event-summit';

function role(partial: Partial<Omit<ContextRole, 'permissions'>> & { permissions: string[] }): ContextRole {
  return {
    roleId: partial.roleId ?? 'role-x',
    key: partial.key ?? 'x',
    name: partial.name ?? 'Role X',
    scopeType: partial.scopeType ?? 'ORGANIZATION',
    scopeId: partial.scopeId ?? null,
    isMasterAdmin: partial.isMasterAdmin ?? false,
    permissions: new Set(partial.permissions),
  };
}

function ctx(partial: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    organizationId: ORG,
    departmentId: null,
    sessionId: 'session-1',
    hasMasterRole: false,
    privileged: false,
    roles: [],
    teamIds: [],
    eventIds: [],
    ...partial,
  };
}

function policy(overrides: PolicyOverride[] = [], disabled: string[] = []): PolicySnapshot {
  const permissions = new Map([
    ['team.update', 'teams'],
    ['team.create', 'teams'],
    ['finance.view', 'finance'],
    ['finance.approve', 'finance'],
    ['meeting.create', 'meetings'],
  ]);
  const modules = new Map<string, 'ENABLED' | 'DISABLED' | 'PLANNED'>([
    ['teams', 'ENABLED'],
    ['finance', 'ENABLED'],
    ['meetings', 'ENABLED'],
  ]);
  for (const m of disabled) modules.set(m, 'DISABLED');
  return { permissions, modules, overrides };
}

let n = 0;
const override = (o: Omit<PolicyOverride, 'id'>): PolicyOverride => ({ id: `o${++n}`, ...o });

describe('keyMatches', () => {
  it('matches exact keys, module wildcards and *', () => {
    expect(keyMatches('finance.view', 'finance.view')).toBe(true);
    expect(keyMatches('finance.*', 'finance.approve')).toBe(true);
    expect(keyMatches('finance.*', 'financial.view')).toBe(false);
    expect(keyMatches('*', 'team.create')).toBe(true);
    expect(keyMatches('team.view', 'team.update')).toBe(false);
  });
});

describe('evaluate', () => {
  it('denies unknown permissions and permissions of disabled modules', () => {
    const c = ctx({ roles: [role({ permissions: ['finance.view'] })] });
    expect(evaluate(c, 'nope.view', policy()).allowed).toBe(false);
    expect(evaluate(c, 'finance.view', policy([], ['finance'])).allowed).toBe(false);
  });

  it('disabled modules deny even a privileged Master Admin', () => {
    const c = ctx({ hasMasterRole: true, privileged: true });
    expect(evaluate(c, 'team.create', policy()).allowed).toBe(true);
    expect(evaluate(c, 'finance.view', policy([], ['finance'])).allowed).toBe(false);
  });

  it('a Master Admin role without a privileged session gets no implicit access', () => {
    const c = ctx({ hasMasterRole: true, privileged: false, roles: [role({ isMasterAdmin: true, permissions: [] })] });
    expect(evaluate(c, 'team.create', policy()).allowed).toBe(false);
  });

  it('grants through an organization-wide role', () => {
    const c = ctx({ roles: [role({ permissions: ['team.update'] })] });
    expect(evaluate(c, 'team.update', policy(), { teamId: TECH_TEAM }).allowed).toBe(true);
  });

  it('a team-scoped role only applies to its own team (contextual access)', () => {
    const creativeLead = ctx({
      teamIds: [CREATIVE_TEAM],
      roles: [role({ name: 'Creative Lead', scopeType: 'TEAM', scopeId: CREATIVE_TEAM, permissions: ['team.update'] })],
    });
    expect(evaluate(creativeLead, 'team.update', policy(), { teamId: CREATIVE_TEAM }).allowed).toBe(true);
    expect(evaluate(creativeLead, 'team.update', policy(), { teamId: TECH_TEAM }).allowed).toBe(false);
    // No target → "holds it somewhere"
    expect(evaluate(creativeLead, 'team.update', policy()).allowed).toBe(true);
  });

  it('an event-scoped role only applies to that event', () => {
    const c = ctx({ roles: [role({ scopeType: 'EVENT', scopeId: SUMMIT, permissions: ['meeting.create'] })] });
    expect(evaluate(c, 'meeting.create', policy(), { eventId: SUMMIT }).allowed).toBe(true);
    expect(evaluate(c, 'meeting.create', policy(), { eventId: 'other' }).allowed).toBe(false);
  });

  it('cascades GLOBAL → TEAM → USER: the most specific level wins (arch doc §10 example)', () => {
    const member = ctx({ userId: 'special', teamIds: [CREATIVE_TEAM] });
    const overrides = [
      override({ scopeType: 'GLOBAL', scopeId: 'global', permissionKey: 'finance.*', effect: 'ALLOW' }),
      override({ scopeType: 'TEAM', scopeId: CREATIVE_TEAM, permissionKey: 'finance.*', effect: 'DENY' }),
    ];
    // Creative Team: Finance OFF
    expect(evaluate(member, 'finance.view', policy(overrides)).allowed).toBe(false);
    // Someone outside the Creative team still gets the GLOBAL allow
    expect(evaluate(ctx({ teamIds: [TECH_TEAM] }), 'finance.view', policy(overrides)).allowed).toBe(true);

    // Specific authorized user: VIEW ONLY
    const withUser = [
      ...overrides,
      override({ scopeType: 'USER', scopeId: 'special', permissionKey: 'finance.view', effect: 'ALLOW' }),
    ];
    expect(evaluate(member, 'finance.view', policy(withUser)).allowed).toBe(true);
    expect(evaluate(member, 'finance.approve', policy(withUser)).allowed).toBe(false);
  });

  it('DENY beats ALLOW within the same level', () => {
    const c = ctx({ roles: [role({ roleId: 'r1', permissions: [] }), role({ roleId: 'r2', permissions: [] })] });
    const overrides = [
      override({ scopeType: 'ROLE', scopeId: 'r1', permissionKey: 'finance.view', effect: 'ALLOW' }),
      override({ scopeType: 'ROLE', scopeId: 'r2', permissionKey: 'finance.*', effect: 'DENY' }),
    ];
    expect(evaluate(c, 'finance.view', policy(overrides)).allowed).toBe(false);
  });

  it('a ROLE override can revoke what the role itself grants', () => {
    const c = ctx({ roles: [role({ roleId: 'creative-lead', permissions: ['finance.view'] })] });
    const overrides = [
      override({ scopeType: 'ROLE', scopeId: 'creative-lead', permissionKey: 'finance.view', effect: 'DENY' }),
    ];
    expect(evaluate(c, 'finance.view', policy()).allowed).toBe(true);
    expect(evaluate(c, 'finance.view', policy(overrides)).allowed).toBe(false);
  });

  it('team overrides follow the target resource when one is given', () => {
    const c = ctx({ teamIds: [CREATIVE_TEAM], roles: [role({ permissions: ['team.update'] })] });
    const overrides = [
      override({ scopeType: 'TEAM', scopeId: TECH_TEAM, permissionKey: 'team.update', effect: 'DENY' }),
    ];
    expect(evaluate(c, 'team.update', policy(overrides), { teamId: TECH_TEAM }).allowed).toBe(false);
    expect(evaluate(c, 'team.update', policy(overrides), { teamId: CREATIVE_TEAM }).allowed).toBe(true);
  });

  it('ignores overrides for other organizations', () => {
    const c = ctx();
    const overrides = [
      override({ scopeType: 'ORGANIZATION', scopeId: 'other-org', permissionKey: 'team.create', effect: 'ALLOW' }),
    ];
    expect(evaluate(c, 'team.create', policy(overrides)).allowed).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('lists only keys the user can use somewhere', () => {
    const c = ctx({ roles: [role({ permissions: ['team.update', 'finance.view'] })] });
    expect(effectivePermissions(c, policy([], ['finance']))).toEqual(['team.update']);
  });
});

describe('visibleModules', () => {
  it('lists only modules the person holds a permission in', () => {
    const c = ctx({ roles: [role({ permissions: ['team.update'] })] });
    expect(visibleModules(c, policy())).toEqual(['teams']);
  });

  it('drops a module hidden from one person by a USER override', () => {
    const c = ctx({ roles: [role({ permissions: ['team.update', 'finance.view', 'finance.approve'] })] });
    const hidden = [override({ scopeType: 'USER', scopeId: 'user-1', permissionKey: 'finance.*', effect: 'DENY' })];
    expect(visibleModules(c, policy())).toEqual(['finance', 'teams']);
    expect(visibleModules(c, policy(hidden))).toEqual(['teams']);
  });

  it('leaves the module visible for everyone else', () => {
    const other = ctx({ userId: 'user-2', roles: [role({ permissions: ['finance.view'] })] });
    const hidden = [override({ scopeType: 'USER', scopeId: 'user-1', permissionKey: 'finance.*', effect: 'DENY' })];
    expect(visibleModules(other, policy(hidden))).toEqual(['finance']);
  });

  it('keeps a module visible when only some actions are denied', () => {
    const c = ctx({ roles: [role({ permissions: ['finance.view', 'finance.approve'] })] });
    const partial = [override({ scopeType: 'USER', scopeId: 'user-1', permissionKey: 'finance.approve', effect: 'DENY' })];
    expect(visibleModules(c, policy(partial))).toEqual(['finance']);
  });

  it('never shows a disabled module, permission or not', () => {
    const c = ctx({ roles: [role({ permissions: ['finance.view'] })] });
    expect(visibleModules(c, policy([], ['finance']))).toEqual([]);
  });
});

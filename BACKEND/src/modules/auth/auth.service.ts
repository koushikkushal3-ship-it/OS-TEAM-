import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../permissions/permission-engine.js';
import { PermissionService } from '../permissions/permission.service.js';
import { PlatformSettingsService, maintenanceFor } from '../platform/platform-settings.service.js';
import { SessionService } from './session.service.js';

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

export type LoginFailure = 'not_invited' | 'disabled' | 'account_mismatch' | 'unverified_email' | 'wrong_domain';

export class LoginError extends Error {
  constructor(readonly reason: LoginFailure) {
    super(reason);
  }
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly settings: PlatformSettingsService,
  ) {}

  googleAuthUrl(state: string) {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    if (env.GOOGLE_ALLOWED_DOMAIN) params.set('hd', env.GOOGLE_ALLOWED_DOMAIN);
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeGoogleCode(code: string): Promise<GoogleProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) throw new Error(`Google userinfo failed (${profileRes.status})`);
    return (await profileRes.json()) as GoogleProfile;
  }

  /** Only people already added by Master Admin can sign in. Returns a session token. */
  async loginWithGoogle(profile: GoogleProfile, meta: { ip?: string; userAgent?: string }) {
    if (!profile.email_verified) throw new LoginError('unverified_email');
    if (env.GOOGLE_ALLOWED_DOMAIN && profile.hd !== env.GOOGLE_ALLOWED_DOMAIN) throw new LoginError('wrong_domain');

    const user = await this.prisma.user.findUnique({ where: { email: profile.email.toLowerCase() } });
    if (!user) {
      this.logger.warn(`Rejected sign-in for uninvited ${profile.email}`);
      throw new LoginError('not_invited');
    }
    if (user.googleSubject && user.googleSubject !== profile.sub) throw new LoginError('account_mismatch');

    return this.completeLogin(user.id, meta, {
      googleSubject: profile.sub,
      avatarUrl: profile.picture ?? user.avatarUrl,
      name: user.name || profile.name || user.email,
    });
  }

  async loginWithDevEmail(email: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new LoginError('not_invited');
    return this.completeLogin(user.id, meta, {});
  }

  private async completeLogin(
    userId: string,
    meta: { ip?: string; userAgent?: string },
    profile: { googleSubject?: string; avatarUrl?: string | null; name?: string },
  ) {
    const existing = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (existing.status === 'DISABLED') throw new LoginError('disabled');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...profile, status: 'ACTIVE', lastLoginAt: new Date() },
    });
    const token = await this.sessions.create(user.id, meta);
    await this.audit.record(
      { userId: user.id, organizationId: user.organizationId, ip: meta.ip, userAgent: meta.userAgent },
      { action: existing.status === 'INVITED' ? 'auth.first_login' : 'auth.login', entityType: 'user', entityId: user.id },
    );
    return token;
  }

  async me(auth: AuthContext) {
    const [user, permissions, modules, plannedModules] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          status: true,
          organization: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          teamMemberships: {
            select: { memberRole: true, team: { select: { id: true, name: true } } },
          },
        },
      }),
      this.permissions.effective(auth),
      this.permissions.visibleModules(auth),
      this.permissions.plannedModules(),
    ]);

    const [session, maintenance] = await Promise.all([
      this.prisma.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
        select: { privilegedUntil: true, impersonatorId: true, expiresAt: true },
      }),
      this.settings.maintenance(),
    ]);
    const impersonator = session.impersonatorId
      ? await this.prisma.user.findUnique({ where: { id: session.impersonatorId }, select: { name: true } })
      : null;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        organization: user.organization,
        department: user.department,
      },
      roles: auth.roles
        .filter((r) => !r.isMasterAdmin)
        .map((r) => ({ id: r.roleId, key: r.key, name: r.name, scopeType: r.scopeType, scopeId: r.scopeId })),
      teams: user.teamMemberships.map((m) => ({ ...m.team, memberRole: m.memberRole })),
      permissions,
      modules,
      plannedModules,
      maintenance: maintenanceFor(maintenance, auth.userId),
      viewAs: impersonator ? { impersonatorName: impersonator.name, expiresAt: session.expiresAt } : null,
      // Only present for eligible users — others get no hint the control plane exists.
      ...(auth.hasMasterRole && {
        master: { privileged: auth.privileged, privilegedUntil: auth.privileged ? session.privilegedUntil : null },
      }),
    };
  }
}

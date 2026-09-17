import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { env, isProduction } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Separate cookie so a preview never replaces the Master Admin's own session. */
export const VIEW_AS_COOKIE = 'teamos_view_as';
export const VIEW_AS_MINUTES = 30;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  get cookieName() {
    return env.SESSION_COOKIE_NAME;
  }

  cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: env.SESSION_TTL_HOURS * 3600_000,
    };
  }

  /** Returns the raw token for the cookie; only its SHA-256 hash is stored. */
  async create(userId: string, meta: { ip?: string; userAgent?: string }) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
        expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000),
      },
    });
    return token;
  }

  async resolve(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            status: true,
            organizationId: true,
            departmentId: true,
            mustChangePassword: true,
          },
        },
      },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    // A preview may show someone who has not signed in yet; a disabled person is never shown.
    const allowed = session.impersonatorId ? session.user.status !== 'DISABLED' : session.user.status === 'ACTIVE';
    if (!allowed) return null;

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return session;
  }

  /** Read-only preview of the portal as another person, opened by a Master Admin. */
  async createViewAs(userId: string, impersonatorId: string, meta: { ip?: string; userAgent?: string }) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId,
        impersonatorId,
        tokenHash: hashToken(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500),
        expiresAt: new Date(Date.now() + VIEW_AS_MINUTES * 60_000),
      },
    });
    return token;
  }

  async revokeOthers(userId: string, keepSessionId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: { not: keepSessionId } }, data: { revokedAt: new Date() } });
  }

  async revokeByToken(token: string) {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

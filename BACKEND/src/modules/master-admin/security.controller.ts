import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import argon2 from 'argon2';
import { z } from 'zod';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GatewaySettingsService } from './gateway-settings.service.js';

const settingsBody = z.object({
  gatewayEnabled: z.boolean().optional(),
  mfaRequired: z.boolean().optional(),
  sessionMinutes: z.number().int().min(5).max(480).optional(),
});

const codeBody = z.object({ code: z.string().min(8, 'Use at least 8 characters').max(200) });

@MasterOnly()
@Controller('master/security')
export class SecurityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: GatewaySettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async overview(@Req() req: AuthenticatedRequest) {
    const orgId = req.user.organizationId;
    const { codeHash, ...settings } = await this.settings.get();
    const [eligible, privilegedSessions] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId: orgId, roles: { some: { role: { isMasterAdmin: true } } } },
        select: { id: true, name: true, email: true, status: true, adminMfa: { select: { enabledAt: true } } },
      }),
      this.prisma.session.findMany({
        where: { user: { organizationId: orgId }, revokedAt: null, privilegedUntil: { gt: new Date() } },
        select: {
          id: true,
          ip: true,
          userAgent: true,
          privilegedUntil: true,
          lastSeenAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);
    return {
      settings: { ...settings, codeConfigured: !!codeHash },
      eligible: eligible.map(({ adminMfa, ...u }) => ({ ...u, mfaEnrolled: !!adminMfa?.enabledAt })),
      privilegedSessions: privilegedSessions.map((s) => ({ ...s, current: s.id === req.session.id })),
    };
  }

  @Patch()
  async update(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>) {
    const { codeHash: _old, ...before } = await this.settings.get();
    const gatewayEnabled = body.gatewayEnabled ?? before.gatewayEnabled;
    const mfaRequired = body.mfaRequired ?? before.mfaRequired;
    if (!gatewayEnabled && !mfaRequired) {
      throw new BadRequestException('Keep at least one of the gateway code or MFA enabled');
    }
    const { codeHash: _new, ...after } = await this.settings.update(body, req.user.id);
    await this.audit.record(actorFrom(req), { action: 'security.settings_changed', entityType: 'system_setting', entityId: 'master.gateway', oldValue: before, newValue: after });
    return after;
  }

  @Post('code')
  @HttpCode(204)
  async rotateCode(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(codeBody)) body: z.infer<typeof codeBody>) {
    await this.settings.update({ codeHash: await argon2.hash(body.code) }, req.user.id);
    await this.audit.record(actorFrom(req), { action: 'security.gateway_code_rotated', entityType: 'system_setting', entityId: 'master.gateway' });
  }

  @Post('sessions/:id/revoke')
  @HttpCode(204)
  async revokePrivilege(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const session = await this.prisma.session.findFirstOrThrow({
      where: { id, user: { organizationId: req.user.organizationId } },
    });
    await this.prisma.session.update({ where: { id }, data: { privilegedUntil: null, gatewayVerifiedAt: null } });
    await this.audit.record(actorFrom(req), {
      action: 'security.privileged_session_revoked',
      entityType: 'session',
      entityId: id,
      oldValue: { userId: session.userId, privilegedUntil: session.privilegedUntil },
    });
  }

  /** Forces a Master Admin to re-enrol their authenticator (lost device). */
  @Post('mfa/:userId/reset')
  @HttpCode(204)
  async resetMfa(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    if (userId === req.user.id) throw new BadRequestException('Another Master Admin must reset your MFA');
    await this.prisma.user.findFirstOrThrow({ where: { id: userId, organizationId: req.user.organizationId } });
    await this.prisma.$transaction([
      this.prisma.adminMfa.deleteMany({ where: { userId } }),
      this.prisma.session.updateMany({ where: { userId }, data: { privilegedUntil: null, gatewayVerifiedAt: null } }),
    ]);
    await this.audit.record(actorFrom(req), { action: 'security.mfa_reset', entityType: 'user', entityId: userId });
  }
}

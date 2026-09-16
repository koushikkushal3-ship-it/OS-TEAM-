import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import argon2 from 'argon2';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { decryptSecret, encryptSecret } from '../../common/utils/crypto.js';
import { FailureLimiter } from '../../common/utils/rate-limiter.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { GatewaySettingsService } from './gateway-settings.service.js';

/** The code step must be followed by MFA within this window. */
const CODE_STEP_WINDOW_MS = 10 * 60_000;

const limiter = new FailureLimiter(5, 15 * 60_000);

/**
 * Hidden Master Admin gateway (arch doc §4, §50):
 * normal login → eligibility → secondary code → MFA → privileged session.
 * Every route returns 404 to users who do not hold a Master Admin role.
 */
@Controller('master/gateway')
export class GatewayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: GatewaySettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async status(@Req() req: AuthenticatedRequest) {
    this.assertEligible(req);
    const [settings, mfa] = await Promise.all([
      this.settings.get(),
      this.prisma.adminMfa.findUnique({ where: { userId: req.user.id } }),
    ]);
    return {
      gatewayEnabled: settings.gatewayEnabled,
      codeVerified: this.codeStepDone(req, settings.gatewayEnabled),
      mfaRequired: settings.mfaRequired,
      mfaEnrolled: !!mfa?.enabledAt,
      privileged: req.auth.privileged,
      privilegedUntil: req.auth.privileged ? req.session.privilegedUntil : null,
    };
  }

  @Post('code')
  @HttpCode(200)
  async verifyCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(z.object({ code: z.string().min(1).max(200) }))) body: { code: string },
  ) {
    this.assertEligible(req);
    const key = `code:${req.user.id}`;
    limiter.assertAllowed(key);

    const settings = await this.settings.get();
    if (!settings.gatewayEnabled) return this.status(req);
    if (!settings.codeHash) throw new ConflictException('Gateway code has not been configured');

    if (!(await argon2.verify(settings.codeHash, body.code))) {
      limiter.fail(key);
      await this.audit.record(actorFrom(req), { action: 'master.gateway.code_failed', entityType: 'session', entityId: req.session.id });
      throw new ForbiddenException({ message: 'Invalid code', code: 'INVALID_CODE' });
    }
    limiter.reset(key);

    const now = new Date();
    await this.prisma.session.update({
      where: { id: req.session.id },
      data: {
        gatewayVerifiedAt: now,
        ...(!settings.mfaRequired && { privilegedUntil: new Date(now.getTime() + settings.sessionMinutes * 60_000) }),
      },
    });
    req.session.gatewayVerifiedAt = now;
    await this.audit.record(actorFrom(req), { action: 'master.gateway.code_verified', entityType: 'session', entityId: req.session.id });

    if (!settings.mfaRequired) {
      await this.audit.record(actorFrom(req), { action: 'master.session.started', entityType: 'session', entityId: req.session.id });
      return { ...(await this.status(req)), privileged: true };
    }
    return this.status(req);
  }

  /** First-time TOTP enrolment: returns a QR code for an authenticator app. */
  @Post('mfa/setup')
  @HttpCode(200)
  async setupMfa(@Req() req: AuthenticatedRequest) {
    this.assertEligible(req);
    const settings = await this.settings.get();
    if (!this.codeStepDone(req, settings.gatewayEnabled)) throw new ForbiddenException('Verify the gateway code first');

    const existing = await this.prisma.adminMfa.findUnique({ where: { userId: req.user.id } });
    if (existing?.enabledAt) throw new ConflictException('MFA is already enrolled');

    const secret = generateSecret();
    await this.prisma.adminMfa.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, secretEncrypted: encryptSecret(secret) },
      update: { secretEncrypted: encryptSecret(secret) },
    });
    const otpauthUrl = generateURI({ issuer: 'TEAM OS Master', label: req.user.email, secret });
    return { otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl), secret };
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodPipe(z.object({ token: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }))) body: { token: string },
  ) {
    this.assertEligible(req);
    const key = `mfa:${req.user.id}`;
    limiter.assertAllowed(key);

    const settings = await this.settings.get();
    if (!this.codeStepDone(req, settings.gatewayEnabled)) throw new ForbiddenException('Verify the gateway code first');
    if (!settings.mfaRequired) throw new BadRequestException('MFA is not required');

    const mfa = await this.prisma.adminMfa.findUnique({ where: { userId: req.user.id } });
    if (!mfa) throw new BadRequestException('Set up MFA first');

    const result = await verify({ secret: decryptSecret(mfa.secretEncrypted), token: body.token, epochTolerance: 30 });
    if (!result.valid) {
      limiter.fail(key);
      await this.audit.record(actorFrom(req), { action: 'master.gateway.mfa_failed', entityType: 'session', entityId: req.session.id });
      throw new ForbiddenException({ message: 'Invalid authenticator code', code: 'INVALID_MFA' });
    }
    limiter.reset(key);

    const privilegedUntil = new Date(Date.now() + settings.sessionMinutes * 60_000);
    await this.prisma.$transaction([
      ...(mfa.enabledAt ? [] : [this.prisma.adminMfa.update({ where: { userId: req.user.id }, data: { enabledAt: new Date() } })]),
      this.prisma.session.update({ where: { id: req.session.id }, data: { privilegedUntil } }),
    ]);
    await this.audit.record(
      { ...actorFrom(req), privileged: true },
      { action: 'master.session.started', entityType: 'session', entityId: req.session.id, newValue: { privilegedUntil } },
    );
    return { privileged: true, privilegedUntil };
  }

  @Post('exit')
  @HttpCode(204)
  async exit(@Req() req: AuthenticatedRequest) {
    this.assertEligible(req);
    await this.prisma.session.update({
      where: { id: req.session.id },
      data: { privilegedUntil: null, gatewayVerifiedAt: null },
    });
    await this.audit.record(actorFrom(req), { action: 'master.session.ended', entityType: 'session', entityId: req.session.id });
  }

  private assertEligible(req: AuthenticatedRequest) {
    if (!req.auth.hasMasterRole) throw new NotFoundException();
  }

  private codeStepDone(req: AuthenticatedRequest, gatewayEnabled: boolean) {
    if (!gatewayEnabled) return true;
    const at = req.session.gatewayVerifiedAt;
    return !!at && Date.now() - at.getTime() < CODE_STEP_WINDOW_MS;
  }
}

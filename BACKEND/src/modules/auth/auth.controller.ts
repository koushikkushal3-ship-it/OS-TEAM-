import { Body, Controller, Get, HttpCode, NotFoundException, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { devLoginEnabled, env, googleLoginEnabled, isProduction } from '../../config/env.js';
import { FailureLimiter } from '../../common/utils/rate-limiter.js';
import { actorFrom } from '../../common/types.js';
import { AuditService } from '../audit/audit.service.js';
import { Public } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import type { AuthenticatedRequest } from '../../common/types.js';
import { AuthService, LoginError } from './auth.service.js';
import { SessionService } from './session.service.js';

const STATE_COOKIE = 'teamos_oauth_state';

// Password sign-in and password change have no attempt limit (owner's decision, 2026-09-17).
// Only first-time setup, which is proven with the gateway code, still pauses after repeated failures.
const emailLimiter = new FailureLimiter(5, 15 * 60_000);
const ipLimiter = new FailureLimiter(50, 15 * 60_000);

const loginBody = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
const firstSetupBody = z.object({ email: z.string().trim().toLowerCase().email(), gatewayCode: z.string().min(1).max(200), password: z.string().min(1).max(200) });
const changeBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Which sign-in methods the login page should show. */
  @Public()
  @Get('providers')
  async providers() {
    return { password: true, google: googleLoginEnabled(), devLogin: devLoginEnabled, firstSetup: await this.auth.firstSetupAvailable() };
  }

  @Public()
  @Get('google')
  google(@Res() res: Response) {
    if (!googleLoginEnabled()) return res.redirect(`${env.FRONTEND_URL}/login?error=google_not_configured`);
    const state = randomBytes(24).toString('base64url');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 10 * 60_000,
      path: '/',
    });
    return res.redirect(this.auth.googleAuthUrl(state));
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const fail = (reason: string) => res.redirect(`${env.FRONTEND_URL}/login?error=${reason}`);
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/' });
    if (!code || !state || !expected || state !== expected) return fail('invalid_state');

    try {
      const profile = await this.auth.exchangeGoogleCode(code);
      const token = await this.auth.loginWithGoogle(profile, { ip: req.ip, userAgent: req.headers['user-agent'] });
      res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
      return res.redirect(`${env.FRONTEND_URL}/dashboard`);
    } catch (err) {
      return fail(err instanceof LoginError ? err.reason : 'google_failed');
    }
  }

  /** Email + password sign-in. Accounts and first passwords are created by Master Admin only. */
  @Public()
  @Post('login')
  @HttpCode(204)
  async login(@Body(new ZodPipe(loginBody)) body: z.infer<typeof loginBody>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const token = await this.auth.loginWithPassword(body.email, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
      res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    } catch (err) {
      if (!(err instanceof LoginError)) throw err;
      if (err.reason === 'disabled') throw new UnauthorizedException({ message: 'This account is disabled. Contact your Master Admin.', code: 'disabled' });
      throw new UnauthorizedException({ message: 'Wrong email or password', code: 'wrong_password' });
    }
  }

  /** First Master Admin password, proven with the gateway code. Signs them in on success. */
  @Public()
  @Post('first-setup')
  @HttpCode(204)
  async firstSetup(@Body(new ZodPipe(firstSetupBody)) body: z.infer<typeof firstSetupBody>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const key = `setup:${req.ip}`;
    ipLimiter.assertAllowed(key);
    emailLimiter.assertAllowed(`setup:${body.email}`);
    try {
      const token = await this.auth.firstSetup(body.email, body.gatewayCode, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
      res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    } catch (err) {
      if (!(err instanceof LoginError)) throw err;
      ipLimiter.fail(key);
      emailLimiter.fail(`setup:${body.email}`);
      throw new UnauthorizedException({ message: 'That email or gateway code is not right, or setup was already done', code: 'setup_failed' });
    }
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@Req() req: AuthenticatedRequest, @Body(new ZodPipe(changeBody)) body: z.infer<typeof changeBody>) {
    try {
      await this.auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
    } catch (err) {
      if (err instanceof LoginError) {
        throw new UnauthorizedException({ message: 'Your current password is not right', code: 'wrong_password' });
      }
      throw err;
    }
    // Other devices signed in with the old password are signed out.
    await this.sessions.revokeOthers(req.user.id, req.session.id);
    await this.audit.record(actorFrom(req), { action: 'user.password_changed', entityType: 'user', entityId: req.user.id });
  }

  /** Development-only sign-in by email (for local testing before Google OAuth is configured). */
  @Public()
  @Post('dev-login')
  @HttpCode(204)
  async devLogin(
    @Body(new ZodPipe(z.object({ email: z.string().email() }))) body: { email: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!devLoginEnabled) throw new NotFoundException();
    try {
      const token = await this.auth.loginWithDevEmail(body.email, { ip: req.ip, userAgent: req.headers['user-agent'] });
      res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    } catch (err) {
      if (err instanceof LoginError) throw new NotFoundException({ message: 'Sign-in failed', code: err.reason });
      throw err;
    }
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.auth.me(req.auth);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[this.sessions.cookieName];
    if (token) await this.sessions.revokeByToken(token);
    res.clearCookie(this.sessions.cookieName, { path: '/' });
  }
}

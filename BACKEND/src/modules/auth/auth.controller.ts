import { Body, Controller, Get, HttpCode, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { devLoginEnabled, env, googleConfigured, isProduction } from '../../config/env.js';
import { Public } from '../../common/decorators/auth.decorators.js';
import { ZodPipe } from '../../common/pipes/zod.pipe.js';
import type { AuthenticatedRequest } from '../../common/types.js';
import { AuthService, LoginError } from './auth.service.js';
import { SessionService } from './session.service.js';

const STATE_COOKIE = 'teamos_oauth_state';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Which sign-in methods the login page should show. */
  @Public()
  @Get('providers')
  providers() {
    return { google: googleConfigured(), devLogin: devLoginEnabled };
  }

  @Public()
  @Get('google')
  google(@Res() res: Response) {
    if (!googleConfigured()) return res.redirect(`${env.FRONTEND_URL}/login?error=google_not_configured`);
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

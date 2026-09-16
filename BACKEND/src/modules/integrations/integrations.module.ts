import { Controller, Get, HttpCode, Module, Post, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { MasterOnly } from '../../common/decorators/auth.decorators.js';
import { type AuthenticatedRequest, actorFrom } from '../../common/types.js';
import { env } from '../../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { GoogleDriveService } from './google-drive.service.js';
import { GoogleCalendarService } from './google-calendar.service.js';

const STATE_COOKIE = 'teamos_drive_state';

/** Master Admin → Integrations. Google Drive holds every file TEAM OS stores. */
@MasterOnly()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly drive: GoogleDriveService,
    private readonly audit: AuditService,
  ) {}

  @Get('google-drive')
  status() {
    return this.drive.status();
  }

  /** Sends the browser to Google to grant access to the organization's Drive. */
  @Get('google-drive/connect')
  connect(@Res() res: Response) {
    const state = randomBytes(24).toString('base64url');
    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 10 * 60_000 });
    return res.redirect(this.drive.authUrl(state));
  }

  @Get('google-drive/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const expected = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: '/' });
    const settingsPage = `${env.FRONTEND_URL}/master/integrations`;

    if (!code || !state || state !== expected) return res.redirect(`${settingsPage}?error=invalid_state`);
    try {
      const status = await this.drive.connect(code, req.user.id);
      await this.audit.record(actorFrom(req), {
        action: 'integration.google_drive_connected',
        entityType: 'integration',
        entityId: 'google_drive',
        newValue: { account: status.connectedEmail },
      });
      return res.redirect(`${settingsPage}?connected=1`);
    } catch (err) {
      return res.redirect(`${settingsPage}?error=${encodeURIComponent((err as Error).message).slice(0, 200)}`);
    }
  }

  @Post('google-drive/disconnect')
  @HttpCode(204)
  async disconnect(@Req() req: AuthenticatedRequest) {
    const before = await this.drive.status();
    await this.drive.disconnect();
    await this.audit.record(actorFrom(req), {
      action: 'integration.google_drive_disconnected',
      entityType: 'integration',
      entityId: 'google_drive',
      oldValue: { account: before.connectedEmail },
    });
  }
}

@Module({
  controllers: [IntegrationsController],
  providers: [GoogleDriveService, GoogleCalendarService],
  exports: [GoogleDriveService, GoogleCalendarService],
})
export class IntegrationsModule {}

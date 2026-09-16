import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '../../common/utils/crypto.js';
import { env, googleConfigured } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type AclRule, SCHEDULE_TIME_ZONE, readerChanges } from '../schedule/google-event.js';

export const CALENDAR_SETTINGS_KEY = 'integrations.google_calendar';

/**
 * `calendar.app.created`: create one calendar and manage only the events in it — never the rest of the
 * account's calendars. `calendar.acls`: needed only to share that calendar read-only with members.
 */
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.acls',
  'https://www.googleapis.com/auth/userinfo.email',
];

interface CalendarSettings {
  refreshToken: string;
  connectedEmail: string;
  connectedById: string;
  connectedAt: string;
  calendarId?: string;
  calendarName?: string;
  /** Add every active member as a read-only viewer of the calendar. */
  shareWithMembers: boolean;
  lastShareAt?: string;
  lastShareError?: string | null;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  get redirectUri() {
    return env.GOOGLE_CALENDAR_REDIRECT_URI;
  }

  authUrl(state: string) {
    if (!googleConfigured()) throw new ServiceUnavailableException('Google OAuth is not configured');
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async settings(): Promise<CalendarSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: CALENDAR_SETTINGS_KEY } });
    return (row?.value as unknown as CalendarSettings) ?? null;
  }

  private async save(settings: CalendarSettings) {
    await this.prisma.systemSetting.upsert({
      where: { key: CALENDAR_SETTINGS_KEY },
      create: { key: CALENDAR_SETTINGS_KEY, value: settings as object, updatedById: settings.connectedById },
      update: { value: settings as object },
    });
  }

  async status() {
    const s = await this.settings();
    return {
      configured: googleConfigured(),
      connected: Boolean(s?.refreshToken && s.calendarId),
      connectedEmail: s?.connectedEmail ?? null,
      connectedAt: s?.connectedAt ?? null,
      calendarName: s?.calendarName ?? null,
      calendarUrl: s?.calendarId ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(s.calendarId)}` : null,
      shareWithMembers: s?.shareWithMembers ?? true,
      lastShareAt: s?.lastShareAt ?? null,
      lastShareError: s?.lastShareError ?? null,
      redirectUri: this.redirectUri,
    };
  }

  /** Finishes OAuth, stores the refresh token encrypted, and creates the organization calendar. */
  async connect(code: string, connectedById: string, organizationName: string) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: this.redirectUri, grant_type: 'authorization_code' }),
    });
    if (!res.ok) throw new BadRequestException(`Google refused the connection (${res.status})`);
    const tokens = (await res.json()) as { refresh_token?: string; access_token: string; scope?: string };
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google did not return a refresh token. Remove TEAM OS from your Google account permissions and try again.');
    }
    if (!tokens.scope?.includes('calendar.app.created')) {
      throw new BadRequestException('Calendar permission was not granted. Tick the calendar boxes on the Google consent screen.');
    }
    const profile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const { email } = profile.ok ? ((await profile.json()) as { email?: string }) : { email: undefined };

    const previous = await this.settings();
    const settings: CalendarSettings = {
      refreshToken: encryptSecret(tokens.refresh_token),
      connectedEmail: email ?? 'unknown',
      connectedById,
      connectedAt: new Date().toISOString(),
      shareWithMembers: previous?.shareWithMembers ?? true,
    };
    await this.save(settings);
    this.token = { value: tokens.access_token, expiresAt: Date.now() + 50 * 60_000 };

    // Reconnecting the same account keeps using the calendar it already has.
    const reuse = previous?.calendarId && previous.connectedEmail === settings.connectedEmail ? previous.calendarId : null;
    const calendarName = `${organizationName} · Schedule`;
    const calendarId = reuse ?? (await this.createCalendar(calendarName));
    await this.save({ ...settings, calendarId, calendarName });
    return this.status();
  }

  async disconnect() {
    await this.prisma.systemSetting.deleteMany({ where: { key: CALENDAR_SETTINGS_KEY } });
    this.token = null;
  }

  async setSharing(shareWithMembers: boolean) {
    const s = await this.requireSettings();
    await this.save({ ...s, shareWithMembers });
  }

  // ── events ───────────────────────────────────────────────────

  /** Creates or updates the Google copy of an entry; returns the Google event id. */
  async upsertEvent(googleEventId: string | null, event: object): Promise<string> {
    const { calendarId } = await this.requireSettings();
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId!)}/events`;
    if (googleEventId) {
      const res = await this.api(`${base}/${encodeURIComponent(googleEventId)}?sendUpdates=none`, { method: 'PATCH', body: JSON.stringify(event) }, [404, 410]);
      if (res) return googleEventId;
      // Deleted in Google by hand — create it again.
    }
    const created = await this.api(`${base}?sendUpdates=none`, { method: 'POST', body: JSON.stringify(event) });
    return ((await created!.json()) as { id: string }).id;
  }

  async deleteEvent(googleEventId: string) {
    const { calendarId } = await this.requireSettings();
    await this.api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId!)}/events/${encodeURIComponent(googleEventId)}?sendUpdates=none`, { method: 'DELETE' }, [404, 410]);
  }

  /** Shares the calendar read-only with exactly these Google accounts (or with nobody when sharing is off). */
  async syncReaders(emails: string[]) {
    const s = await this.requireSettings();
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(s.calendarId!)}/acl`;
    try {
      const list = await this.api(`${base}?maxResults=250`);
      const current = ((await list!.json()) as { items?: AclRule[] }).items ?? [];
      const wanted = s.shareWithMembers ? emails.filter((e) => e.toLowerCase() !== s.connectedEmail.toLowerCase()) : [];
      const { add, remove } = readerChanges(current, wanted);
      for (const email of add) {
        await this.api(`${base}?sendNotifications=false`, { method: 'POST', body: JSON.stringify({ role: 'reader', scope: { type: 'user', value: email } }) });
      }
      for (const ruleId of remove) await this.api(`${base}/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }, [404]);
      await this.save({ ...s, lastShareAt: new Date().toISOString(), lastShareError: null });
      return { added: add.length, removed: remove.length };
    } catch (err) {
      await this.save({ ...s, lastShareError: (err as Error).message.slice(0, 300) });
      throw err;
    }
  }

  // ── internals ────────────────────────────────────────────────

  private async requireSettings() {
    const s = await this.settings();
    if (!s?.refreshToken || !s.calendarId) throw new ServiceUnavailableException('Google Calendar is not connected');
    return s;
  }

  private async createCalendar(summary: string) {
    const res = await this.api('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary, description: 'Managed by TEAM OS. Edit the schedule in the portal; changes here are overwritten.', timeZone: SCHEDULE_TIME_ZONE }),
    });
    return ((await res!.json()) as { id: string }).id;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const s = await this.settings();
    if (!s?.refreshToken) throw new ServiceUnavailableException('Google Calendar is not connected');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: decryptSecret(s.refreshToken), grant_type: 'refresh_token' }),
    });
    if (!res.ok) throw new ServiceUnavailableException('Google Calendar access expired. Reconnect it in Master Admin → Integrations.');
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  /** Returns null for the listed "fine to ignore" statuses (e.g. already deleted). */
  private async api(url: string, init: RequestInit = {}, tolerated: number[] = []) {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: `Bearer ${await this.accessToken()}` },
    });
    if (tolerated.includes(res.status)) return null;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`Google Calendar ${init.method ?? 'GET'} failed (${res.status})`);
      throw new ServiceUnavailableException(`Google Calendar request failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res;
  }
}

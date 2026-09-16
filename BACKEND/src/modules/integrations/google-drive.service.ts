import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { env, googleConfigured } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../common/utils/crypto.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export const DRIVE_SETTINGS_KEY = 'integrations.google_drive';

/** Only files TEAM OS creates — never the rest of the connected Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const ROOT_FOLDER_NAME = 'TEAM OS';

interface DriveSettings {
  /** Encrypted refresh token of the connected Google account. */
  refreshToken: string;
  connectedEmail: string;
  connectedById: string;
  connectedAt: string;
  rootFolderId?: string;
  /** Module name → Drive folder id, so files land in tidy subfolders. */
  folders?: Record<string, string>;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  /** Access tokens last an hour; keep one in memory rather than refreshing per request. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  get redirectUri() {
    return env.GOOGLE_DRIVE_REDIRECT_URI;
  }

  /** Where the browser goes to grant TEAM OS access to a Drive. */
  authUrl(state: string) {
    if (!googleConfigured()) throw new ServiceUnavailableException('Google OAuth is not configured');
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: `${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
      access_type: 'offline',
      // Force a refresh token even if this account granted access before.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async settings(): Promise<DriveSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: DRIVE_SETTINGS_KEY } });
    return (row?.value as unknown as DriveSettings) ?? null;
  }

  async status() {
    const settings = await this.settings();
    return {
      configured: googleConfigured(),
      connected: Boolean(settings?.refreshToken),
      connectedEmail: settings?.connectedEmail ?? null,
      connectedAt: settings?.connectedAt ?? null,
      folderName: ROOT_FOLDER_NAME,
      redirectUri: this.redirectUri,
    };
  }

  /** Finishes the OAuth dance and stores the refresh token encrypted. */
  async connect(code: string, connectedById: string) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new BadRequestException(`Google refused the connection (${res.status})`);
    const tokens = (await res.json()) as { refresh_token?: string; access_token: string };
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google did not return a refresh token. Remove TEAM OS from your Google account permissions and try again.');
    }

    const profile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const { email } = profile.ok ? ((await profile.json()) as { email?: string }) : { email: undefined };

    const settings: DriveSettings = {
      refreshToken: encryptSecret(tokens.refresh_token),
      connectedEmail: email ?? 'unknown',
      connectedById,
      connectedAt: new Date().toISOString(),
    };
    await this.save(settings);
    this.token = { value: tokens.access_token, expiresAt: Date.now() + 50 * 60_000 };
    return this.status();
  }

  async disconnect() {
    await this.prisma.systemSetting.deleteMany({ where: { key: DRIVE_SETTINGS_KEY } });
    this.token = null;
  }

  // ── files ────────────────────────────────────────────────────

  async upload(file: { buffer: Buffer; originalname: string; mimetype: string }, folder: string): Promise<DriveFile> {
    const folderId = await this.folderId(folder);

    // Two steps rather than a hand-assembled multipart body: create the metadata,
    // then send the bytes.
    const created = await this.api('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.originalname, parents: [folderId] }),
    });
    const meta = (await created.json()) as { id: string };

    const uploaded = await this.api(
      `https://www.googleapis.com/upload/drive/v3/files/${meta.id}?uploadType=media&fields=id,name,mimeType,size`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': file.mimetype || 'application/octet-stream' },
        body: new Uint8Array(file.buffer),
      },
    );
    const saved = (await uploaded.json()) as { id: string; name: string; mimeType: string; size?: string };
    return { id: saved.id, name: saved.name, mimeType: saved.mimeType, size: Number(saved.size ?? file.buffer.length) };
  }

  /**
   * Uploads text (CSV or JSON) in one multipart request. With `asSheet`, Drive converts a CSV
   * into a real Google Sheet — still only the `drive.file` scope, no Sheets API needed.
   */
  async uploadText(name: string, content: string, folder: string, opts: { mimeType: string; asSheet?: boolean }) {
    const folderId = await this.folderId(folder);
    const boundary = `teamos${Date.now()}`;
    const metadata = {
      name,
      parents: [folderId],
      ...(opts.asSheet && { mimeType: 'application/vnd.google-apps.spreadsheet' }),
    };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.mimeType}; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()) as { id: string; name: string; webViewLink?: string };
  }

  /** Storage used by the connected account; null when Drive is not connected or Google refuses. */
  async quota(): Promise<{ limit: number | null; usage: number } | null> {
    if (!(await this.settings())) return null;
    try {
      const res = await this.api('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
      const q = ((await res.json()) as { storageQuota?: { limit?: string; usage?: string } }).storageQuota;
      return q ? { limit: q.limit ? Number(q.limit) : null, usage: Number(q.usage ?? 0) } : null;
    } catch {
      return null;
    }
  }

  /** Bytes of a file, fetched with the organization's Drive credentials. */
  async download(driveFileId: string): Promise<Buffer> {
    const res = await this.api(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(driveFileId: string) {
    try {
      await this.api(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, { method: 'DELETE' });
    } catch (err) {
      // A file already gone from Drive should not block deleting our record.
      this.logger.warn(`Could not delete Drive file ${driveFileId}: ${(err as Error).message}`);
    }
  }

  // ── internals ────────────────────────────────────────────────

  private async save(settings: DriveSettings) {
    await this.prisma.systemSetting.upsert({
      where: { key: DRIVE_SETTINGS_KEY },
      create: { key: DRIVE_SETTINGS_KEY, value: { ...settings } },
      update: { value: { ...settings } },
    });
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const settings = await this.settings();
    if (!settings?.refreshToken) throw new ServiceUnavailableException('Google Drive is not connected');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: decryptSecret(settings.refreshToken),
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException('Google Drive access expired. Reconnect it in Master Admin → Integrations.');
    }
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  private async api(url: string, init: RequestInit = {}) {
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(`Google Drive request failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res;
  }

  /** Finds or creates "TEAM OS/<folder>" and remembers the ids. */
  private async folderId(folder: string): Promise<string> {
    const settings = await this.settings();
    if (!settings) throw new ServiceUnavailableException('Google Drive is not connected');

    const rootId = settings.rootFolderId ?? (await this.createFolder(ROOT_FOLDER_NAME));
    const folders = settings.folders ?? {};
    const existing = folders[folder];
    if (existing && settings.rootFolderId) return existing;

    const id = existing ?? (await this.createFolder(folder, rootId));
    await this.save({ ...settings, rootFolderId: rootId, folders: { ...folders, [folder]: id } });
    return id;
  }

  private async createFolder(name: string, parentId?: string): Promise<string> {
    const res = await this.api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    const { id } = (await res.json()) as { id: string };
    return id;
  }
}

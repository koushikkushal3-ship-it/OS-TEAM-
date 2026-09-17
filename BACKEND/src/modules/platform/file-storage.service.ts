import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export type StorageProvider = 'database' | 'supabase' | 'google_drive';

/** Largest file kept inside Postgres when Supabase Storage is not set up. */
export const DATABASE_FILE_LIMIT = 10 * 1024 * 1024;

/**
 * Where uploaded files and backups live — no Google account involved.
 * Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (1 GB free, private bucket);
 * otherwise the bytes go into the database so the portal works with zero extra setup.
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private bucketReady = false;

  constructor(private readonly prisma: PrismaService) {}

  get provider(): Exclude<StorageProvider, 'google_drive'> {
    return env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'database';
  }

  /** A readable, collision-free key like files/<org>/<uuid>-invoice.pdf */
  keyFor(folder: string, organizationId: string, name: string) {
    const safe = name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
    return `${folder}/${organizationId}/${randomUUID()}-${safe}`;
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<{ provider: StorageProvider; key: string }> {
    if (this.provider === 'supabase') {
      await this.ensureBucket();
      const res = await fetch(`${this.base()}/object/${env.SUPABASE_STORAGE_BUCKET}/${encodeURI(key)}`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': mimeType || 'application/octet-stream', 'x-upsert': 'true' },
        body: new Uint8Array(data),
      });
      if (!res.ok) throw new ServiceUnavailableException(`File storage refused the upload (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return { provider: 'supabase', key };
    }
    if (data.length > DATABASE_FILE_LIMIT) {
      throw new ServiceUnavailableException('Files over 10 MB need Supabase Storage. Ask the Master Admin to set it up.');
    }
    await this.prisma.fileBlob.upsert({
      where: { key },
      create: { key, data: new Uint8Array(data), size: data.length, mimeType },
      update: { data: new Uint8Array(data), size: data.length, mimeType },
    });
    return { provider: 'database', key };
  }

  async get(provider: StorageProvider, key: string): Promise<Buffer> {
    if (provider === 'database') {
      const blob = await this.prisma.fileBlob.findUnique({ where: { key } });
      if (!blob) throw new ServiceUnavailableException('This file is missing from storage');
      return Buffer.from(blob.data);
    }
    if (provider === 'supabase') {
      if (this.provider !== 'supabase') throw new ServiceUnavailableException('Supabase Storage is not configured on the server');
      const res = await fetch(`${this.base()}/object/${env.SUPABASE_STORAGE_BUCKET}/${encodeURI(key)}`, { headers: this.headers() });
      if (!res.ok) throw new ServiceUnavailableException(`This file could not be read from storage (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    }
    throw new ServiceUnavailableException('This file was stored in the old Google Drive and cannot be opened right now');
  }

  /** Best effort: a file already gone must never block deleting its record. */
  async remove(provider: StorageProvider, key: string | null) {
    if (!key) return;
    try {
      if (provider === 'database') await this.prisma.fileBlob.deleteMany({ where: { key } });
      else if (provider === 'supabase' && this.provider === 'supabase') {
        await fetch(`${this.base()}/object/${env.SUPABASE_STORAGE_BUCKET}`, {
          method: 'DELETE',
          headers: { ...this.headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [key] }),
        });
      }
    } catch (err) {
      this.logger.warn(`Could not delete stored file ${key}: ${(err as Error).message}`);
    }
  }

  private base() {
    return `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
  }

  private headers() {
    return { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY };
  }

  /** Creates the private bucket on first use; "already exists" is fine. */
  private async ensureBucket() {
    if (this.bucketReady) return;
    const res = await fetch(`${this.base()}/bucket`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: env.SUPABASE_STORAGE_BUCKET, name: env.SUPABASE_STORAGE_BUCKET, public: false }),
    });
    if (!res.ok && res.status !== 400 && res.status !== 409) {
      throw new ServiceUnavailableException(`Could not prepare file storage (${res.status})`);
    }
    this.bucketReady = true;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

const TTL_MS = 15_000;

export interface MaintenancePerson {
  userId: string;
  name: string;
  message: string;
  since: string;
}

export interface MaintenanceSetting {
  /** The whole portal, for everyone. */
  enabled: boolean;
  message: string;
  /** Individual people whose portal is closed while everyone else keeps working. */
  people: MaintenancePerson[];
}

/** What one person sees: closed for everyone, closed just for them, or open. */
export function maintenanceFor(setting: MaintenanceSetting, userId: string): { enabled: true; message: string; scope: 'everyone' | 'personal' } | null {
  if (setting.enabled) return { enabled: true, message: setting.message, scope: 'everyone' };
  const personal = setting.people?.find((p) => p.userId === userId);
  return personal ? { enabled: true, message: personal.message || setting.message, scope: 'personal' } : null;
}

export interface BrandingSetting {
  logoUrl: string | null;
  brandColor: string | null;
  loginMessage: string | null;
}

export const MAINTENANCE_KEY = 'platform.maintenance';
export const BRANDING_KEY = 'platform.branding';
export const BACKUPS_KEY = 'platform.backups';

/** Organization-wide switches read on hot paths (every request), so briefly cached. */
@Injectable()
export class PlatformSettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = row ? ({ ...fallback, ...(row.value as object) } as T) : fallback;
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async set<T extends object>(key: string, value: T, userId?: string): Promise<T> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as object, updatedById: userId },
      update: { value: value as object, updatedById: userId },
    });
    this.cache.delete(key);
    return value;
  }

  maintenance() {
    return this.get<MaintenanceSetting>(MAINTENANCE_KEY, { enabled: false, message: '', people: [] });
  }

  branding() {
    return this.get<BrandingSetting>(BRANDING_KEY, { logoUrl: null, brandColor: null, loginMessage: null });
  }
}

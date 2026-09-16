import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export const GATEWAY_SETTINGS_KEY = 'master.gateway';

export interface GatewaySettings {
  /** Require the secondary secret code before MFA. */
  gatewayEnabled: boolean;
  /** argon2 hash of the secondary code. */
  codeHash: string | null;
  mfaRequired: boolean;
  /** Lifetime of a privileged Master Admin session. */
  sessionMinutes: number;
}

export const DEFAULT_GATEWAY_SETTINGS: GatewaySettings = {
  gatewayEnabled: true,
  codeHash: null,
  mfaRequired: true,
  sessionMinutes: 30,
};

@Injectable()
export class GatewaySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<GatewaySettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: GATEWAY_SETTINGS_KEY } });
    return { ...DEFAULT_GATEWAY_SETTINGS, ...(row?.value as Partial<GatewaySettings> | undefined) };
  }

  async update(patch: Partial<GatewaySettings>, updatedById: string): Promise<GatewaySettings> {
    const next = { ...(await this.get()), ...patch };
    await this.prisma.systemSetting.upsert({
      where: { key: GATEWAY_SETTINGS_KEY },
      create: { key: GATEWAY_SETTINGS_KEY, value: { ...next }, updatedById },
      update: { value: { ...next }, updatedById },
    });
    return next;
  }
}

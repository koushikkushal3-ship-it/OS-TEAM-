import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';

export const PRESETS = ['DEFAULT', 'DENIED', 'VIEW_ONLY', 'FULL'] as const;
export type AccessPreset = (typeof PRESETS)[number];
export type DetectedPreset = AccessPreset | 'CUSTOM';
export type ScopeType = 'GLOBAL' | 'ORGANIZATION' | 'DEPARTMENT' | 'TEAM' | 'EVENT' | 'ROLE' | 'USER';

export function detectPreset(
  rows: { permissionKey: string; effect: 'ALLOW' | 'DENY' }[],
  prefix: string | undefined,
  viewKey: string | undefined,
): DetectedPreset {
  if (rows.length === 0) return 'DEFAULT';
  if (rows.length === 1 && rows[0].permissionKey === `${prefix}.*`) return rows[0].effect === 'DENY' ? 'DENIED' : 'FULL';
  const allows = rows.filter((r) => r.effect === 'ALLOW');
  if (allows.length === 1 && allows[0].permissionKey === viewKey) return 'VIEW_ONLY';
  return 'CUSTOM';
}

/**
 * Replaces one scope's overrides for one module with a preset. Shared by the Permissions
 * page, the per-person Access screen and "undo" in the audit log, so all three agree.
 */
export async function applyAccessPreset(
  prisma: PrismaService,
  input: { organizationId: string; scopeType: ScopeType; scopeId: string; moduleKey: string; preset: AccessPreset; expiresAt?: Date | null; userId: string },
) {
  const moduleRow = await prisma.module.findUnique({ where: { key: input.moduleKey }, include: { permissions: { select: { key: true } } } });
  if (!moduleRow) throw new BadRequestException('Unknown module');
  if (moduleRow.isCore) throw new BadRequestException('Core modules cannot use access presets');
  if (input.expiresAt && input.expiresAt <= new Date()) throw new BadRequestException('The end of temporary access must be in the future');

  const moduleKeys = moduleRow.permissions.map((p) => p.key);
  const prefix = moduleKeys[0]?.split('.')[0];
  const viewKey = moduleKeys.find((k) => k.endsWith('.view'));
  const inScope = { organizationId: input.organizationId, scopeType: input.scopeType, scopeId: input.scopeId };
  const moduleFilter = { OR: [{ permissionKey: { in: moduleKeys } }, { permissionKey: `${prefix}.*` }] };

  const existing = await prisma.permissionOverride.findMany({ where: { ...inScope, ...moduleFilter } });
  const oldPreset = detectPreset(existing, prefix, viewKey);

  const rows: { permissionKey: string; effect: 'ALLOW' | 'DENY' }[] =
    input.preset === 'DENIED'
      ? [{ permissionKey: `${prefix}.*`, effect: 'DENY' }]
      : input.preset === 'FULL'
        ? [{ permissionKey: `${prefix}.*`, effect: 'ALLOW' }]
        : input.preset === 'VIEW_ONLY'
          ? moduleKeys.map((k) => ({ permissionKey: k, effect: k === viewKey ? 'ALLOW' : 'DENY' }))
          : [];

  await prisma.$transaction([
    prisma.permissionOverride.deleteMany({ where: { ...inScope, ...moduleFilter } }),
    prisma.permissionOverride.createMany({
      data: rows.map((r) => ({ ...inScope, ...r, createdById: input.userId, expiresAt: input.expiresAt ?? null })),
    }),
  ]);
  return { moduleName: moduleRow.name, oldPreset, oldExpiresAt: existing[0]?.expiresAt ?? null };
}

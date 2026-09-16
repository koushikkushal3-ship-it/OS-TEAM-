import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditActor } from '../../common/types.js';
import { Prisma } from '../../generated/prisma/client.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Converts Dates/Decimals/etc. into plain JSON for the audit record. */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an audit entry. Audit failures are logged but never break the business action. */
  async record(actor: AuditActor | null, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: actor?.organizationId,
          actorId: actor?.userId,
          sessionId: actor?.sessionId,
          privileged: actor?.privileged ?? false,
          ip: actor?.ip,
          userAgent: actor?.userAgent,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          oldValue: toJson(entry.oldValue),
          newValue: toJson(entry.newValue),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit entry ${entry.action}`, err as Error);
    }
  }
}

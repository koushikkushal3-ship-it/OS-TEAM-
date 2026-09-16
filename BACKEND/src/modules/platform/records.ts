import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';

const logger = new Logger('Platform');

export interface NotifyInput {
  organizationId: string;
  userIds: (string | null | undefined)[];
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Usually the person who caused it — nobody needs to be told about their own action. */
  exceptUserId?: string;
}

/**
 * Writes in-app notifications. Never throws: a notification that fails must not
 * undo the task assignment or approval that caused it.
 */
export async function notify(prisma: PrismaService, n: NotifyInput) {
  const ids = [...new Set(n.userIds.filter((id): id is string => !!id && id !== n.exceptUserId))];
  if (ids.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        organizationId: n.organizationId,
        userId,
        type: n.type,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 1000) ?? null,
        link: n.link ?? null,
      })),
    });
  } catch (err) {
    logger.warn(`Notification "${n.type}" not saved: ${(err as Error).message}`);
  }
}

/** Entities the recycle bin can restore, mapped to their Prisma delegate. */
export const BIN_MODELS = {
  task: 'task',
  expense: 'expense',
  budget: 'budget',
  ticket: 'ticket',
  idea: 'idea',
  opportunity: 'opportunity',
  meeting: 'meeting',
  custom_record: 'customRecord',
  event: 'event',
  team: 'team',
  file: 'fileRecord',
  shift: 'shift',
  run_item: 'runItem',
  schedule_entry: 'scheduleEntry',
} as const;
export type BinEntity = keyof typeof BIN_MODELS;

export const BIN_RETENTION_DAYS = 30;

/**
 * Snapshots a row just before it is deleted. This one *does* throw — if the snapshot
 * cannot be saved, the delete should not go ahead and lose the data.
 */
export async function recycle(
  prisma: PrismaService,
  input: {
    organizationId: string;
    entityType: BinEntity;
    row: { id: string };
    label: string;
    deletedById?: string;
    /** Rows the database removes along with this one (cascade), restored after it, in this order. */
    children?: { model: string; rows: object[] }[];
  },
) {
  const children = input.children?.filter((c) => c.rows.length > 0) ?? [];
  const snapshot = children.length ? { __row: input.row, __children: children } : input.row;
  await prisma.deletedRecord.create({
    data: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.row.id,
      label: input.label.slice(0, 200),
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      deletedById: input.deletedById,
    },
  });
}

/** Older snapshots are the bare row; newer ones carry the cascaded children too. */
export function unpackSnapshot(snapshot: unknown): { row: Record<string, unknown>; children: { model: string; rows: object[] }[] } {
  const s = snapshot as { __row?: Record<string, unknown>; __children?: { model: string; rows: object[] }[] };
  return s && s.__row ? { row: s.__row, children: s.__children ?? [] } : { row: snapshot as Record<string, unknown>, children: [] };
}

/** Leads and co-leads of every team the given person belongs to. */
export async function teamLeadsOf(prisma: PrismaService, userId: string): Promise<string[]> {
  const leads = await prisma.teamMember.findMany({
    where: {
      memberRole: { in: ['LEAD', 'CO_LEAD'] },
      userId: { not: userId },
      team: { isActive: true, members: { some: { userId } } },
    },
    select: { userId: true },
  });
  return [...new Set(leads.map((l) => l.userId))];
}

export const CHANGE_KINDS = ['GRANT_MASTER_ADMIN', 'DELETE_CUSTOM_MODULE'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Active Master Admins in the organization. */
export async function masterAdmins(prisma: PrismaService, organizationId: string) {
  const rows = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE', roles: { some: { role: { isMasterAdmin: true, isActive: true } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Two-person rule. With a second Master Admin available, the change becomes a request
 * someone else must approve; with only one, it goes ahead (nobody could ever approve it).
 */
export async function requestSecondApproval(
  prisma: PrismaService,
  input: { organizationId: string; requestedById: string; kind: ChangeKind; summary: string; payload: object },
): Promise<{ pendingApproval: true; requestId: string } | null> {
  const masters = await masterAdmins(prisma, input.organizationId);
  if (masters.filter((id) => id !== input.requestedById).length === 0) return null;
  const request = await prisma.changeRequest.create({ data: { ...input, payload: input.payload } });
  await notify(prisma, {
    organizationId: input.organizationId,
    userIds: masters,
    exceptUserId: input.requestedById,
    type: 'master.approval_needed',
    title: 'A Master Admin change needs your approval',
    body: input.summary,
    link: '/master/approvals',
  });
  return { pendingApproval: true, requestId: request.id };
}

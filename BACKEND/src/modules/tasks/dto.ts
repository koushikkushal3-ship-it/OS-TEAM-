import { z } from 'zod';

export const TASK_STATUSES = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
] as const;

export const createTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullish(),
  teamId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  parentTaskId: z.string().uuid().nullish(),
  assignedToId: z.string().uuid().nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  status: z.enum(TASK_STATUSES).optional(),
  startDate: z.coerce.date().nullish(),
  dueDate: z.coerce.date().nullish(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  percentage: z.number().int().min(0).max(100).optional(),
});

export const listTasksSchema = z.object({
  scope: z.enum(['mine', 'created', 'team', 'event', 'all']).default('all'),
  teamId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  open: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
});

export const workUpdateSchema = z.object({
  percentage: z.number().int().min(0).max(100),
  summary: z.string().trim().min(3).max(3000),
  blockers: z.string().trim().max(2000).nullish(),
  /// Optional explicit status; otherwise derived from percentage and blockers.
  status: z.enum(TASK_STATUSES).optional(),
});

export const reviewSchema = z.object({
  decision: z.enum(['ACCEPT', 'CHANGES_REQUESTED']),
  note: z.string().trim().max(2000).nullish(),
});

export const statsSchema = z.object({
  teamId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type WorkUpdateInput = z.infer<typeof workUpdateSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;

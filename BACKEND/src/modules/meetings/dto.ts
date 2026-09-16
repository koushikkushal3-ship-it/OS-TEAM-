import { z } from 'zod';

export const MEETING_TYPES = [
  'GOOGLE_MEET',
  'INTERNAL',
  'PHYSICAL',
  'WORKSHOP',
  'ONE_TO_ONE',
  'EXTERNAL',
  'EVENT',
  'CUSTOM',
] as const;

export const ATTENDANCE_STATUSES = ['UNKNOWN', 'PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED'] as const;

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(3000).nullish(),
    type: z.enum(MEETING_TYPES).default('INTERNAL'),
    teamId: z.string().uuid().nullish(),
    eventId: z.string().uuid().nullish(),
    joinUrl: z.string().url().max(500).nullish(),
    location: z.string().trim().max(200).nullish(),
    agenda: z.string().trim().max(5000).nullish(),
    scheduledStart: z.coerce.date(),
    scheduledEnd: z.coerce.date(),
    participantIds: z.array(z.string().uuid()).default([]),
  })
  .refine((m) => m.scheduledEnd > m.scheduledStart, { message: 'The meeting must end after it starts' });

export const updateMeetingSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(3000).nullish(),
  type: z.enum(MEETING_TYPES).optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']).optional(),
  teamId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  joinUrl: z.string().url().max(500).nullish(),
  location: z.string().trim().max(200).nullish(),
  agenda: z.string().trim().max(5000).nullish(),
  notes: z.string().trim().max(20000).nullish(),
  scheduledStart: z.coerce.date().optional(),
  scheduledEnd: z.coerce.date().optional(),
});

export const listMeetingsSchema = z.object({
  scope: z.enum(['mine', 'team', 'event', 'all']).default('all'),
  teamId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']).optional(),
  upcoming: z.coerce.boolean().optional(),
  limit: z.coerce.number().min(1).max(200).default(100),
});

export const participantSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['HOST', 'CO_HOST', 'REQUIRED', 'OPTIONAL']).default('REQUIRED'),
});

/** Manual join/leave entry, or the record of someone joining through TEAM OS. */
export const sessionSchema = z.object({
  userId: z.string().uuid().optional(),
  joinedAt: z.coerce.date(),
  leftAt: z.coerce.date().nullish(),
});

export const attendanceOverrideSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().trim().max(500).nullish(),
});

export const decisionSchema = z.object({ text: z.string().trim().min(2).max(2000) });

export const actionItemSchema = z.object({
  text: z.string().trim().min(2).max(500),
  ownerId: z.string().uuid().nullish(),
  dueDate: z.coerce.date().nullish(),
  /** Also create a Phase 2 task for the owner. */
  createTask: z.boolean().default(true),
});

export const attendanceStatsSchema = z.object({
  userId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;
export type ListMeetingsInput = z.infer<typeof listMeetingsSchema>;
export type ParticipantInput = z.infer<typeof participantSchema>;
export type SessionInputDto = z.infer<typeof sessionSchema>;
export type AttendanceOverrideInput = z.infer<typeof attendanceOverrideSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type ActionItemInput = z.infer<typeof actionItemSchema>;
export type AttendanceStatsInput = z.infer<typeof attendanceStatsSchema>;

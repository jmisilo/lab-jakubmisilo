import { z } from 'zod';

export const ManageScheduleInputSchema = z.object({
  action: z.enum([
    'create_one_time',
    'create_recurring',
    'list',
    'cancel',
    'pause',
    'resume',
    'run_now',
    'update',
    'complete_occurrence',
  ]),
  title: z.string().min(1).max(180).optional(),
  prompt: z.string().min(1).max(4_000).optional(),
  runAt: z.iso.datetime({ offset: true }).optional(),
  cron: z.string().min(1).max(100).optional(),
  timeZone: z.string().min(1).max(100).optional(),
  includeInactive: z.boolean().optional(),
  scheduleId: z.string().min(1).optional(),
});

export const ManageScheduleRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_one_time'),
    title: z.string().min(1).max(180),
    prompt: z.string().min(1).max(4_000),
    runAt: z.iso.datetime({ offset: true }),
  }),
  z.object({
    action: z.literal('create_recurring'),
    title: z.string().min(1).max(180),
    prompt: z.string().min(1).max(4_000),
    cron: z.string().min(1).max(100),
    timeZone: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal('list'),
    includeInactive: z.boolean().default(false),
  }),
  z.object({
    action: z.enum(['cancel', 'pause', 'resume', 'run_now', 'complete_occurrence']),
    scheduleId: z.string().min(1),
  }),
  z.object({
    action: z.literal('update'),
    scheduleId: z.string().min(1),
    title: z.string().min(1).max(180).optional(),
    prompt: z.string().min(1).max(4_000).optional(),
    runAt: z.iso.datetime({ offset: true }).optional(),
    cron: z.string().min(1).max(100).optional(),
    timeZone: z.string().min(1).max(100).optional(),
  }),
]);

export const OneTimeSchedulePayloadSchema = z.object({
  scheduleId: z.uuid(),
  revision: z.number().int().positive(),
});

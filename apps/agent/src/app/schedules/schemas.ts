import { z } from 'zod';

export const SCHEDULE_TASK_TITLE_MAX_CHARACTERS = 180;
export const SCHEDULE_TASK_PROMPT_MAX_CHARACTERS = 4_000;
export const SCHEDULE_TASK_LIST_MAX_ITEMS = 50;

const ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export const ScheduleDayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

export const ScheduleTimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe('Local time in 24-hour HH:mm format.');

export const ScheduleRecurrenceSchema = z.object({
  frequency: z
    .enum(['daily', 'weekdays', 'weekly'])
    .describe(
      "Use 'daily' for every day, 'weekdays' for Monday-Friday, and 'weekly' for selected weekdays.",
    ),
  daysOfWeek: z
    .array(ScheduleDayOfWeekSchema)
    .min(1)
    .max(7)
    .optional()
    .describe("Required for 'weekly'. Optional for 'daily' and 'weekdays'."),
  timeOfDay: ScheduleTimeOfDaySchema.optional().describe(
    'Execution time in the user timezone. If the user did not specify a time, choose a sensible time for the task.',
  ),
});

const OneTimeScheduleSchema = z.object({
  type: z.literal('one_time'),
  runAt: z
    .string()
    .min(1)
    .regex(ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN)
    .describe(
      'Future ISO 8601 datetime for the first execution. Include Z or a numeric offset when possible; if omitted, timeZone is used as the local wall-clock timezone.',
    ),
  timeZone: z.string().min(1).describe('IANA timezone used to interpret the schedule.'),
});

const RecurringScheduleSchema = z
  .object({
    type: z.literal('recurring'),
    timeZone: z.string().min(1).describe('IANA timezone used to interpret local recurrence time.'),
    recurrence: ScheduleRecurrenceSchema,
  })
  .describe('Recurring schedule. It must not run more often than once per hour.');

export const ManageScheduleToolContextSchema = z.object({
  identityId: z.string().min(1),
  threadId: z.string().min(1),
  sourceMessageId: z.string().optional(),
});

export const ManageScheduleToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z
      .literal('create')
      .describe(
        'Create a one-time or recurring scheduled AI task. Limits: 10 active one-time tasks and 10 active recurring tasks per user. One-time tasks can be at most 7 days ahead on the current QStash free plan.',
      ),
    title: z
      .string()
      .min(1)
      .max(SCHEDULE_TASK_TITLE_MAX_CHARACTERS)
      .describe('Short user-facing title for this scheduled task.'),
    prompt: z
      .string()
      .min(1)
      .max(SCHEDULE_TASK_PROMPT_MAX_CHARACTERS)
      .describe(
        'Prompt that the scheduled subagent will execute when the task is due. Write it as a durable instruction, not as a transcript.',
      ),
    schedule: z.discriminatedUnion('type', [OneTimeScheduleSchema, RecurringScheduleSchema]),
    userFacingSchedule: z
      .string()
      .min(1)
      .optional()
      .describe('Short natural-language schedule summary for acknowledgement.'),
  }),
  z.object({
    action: z.literal('list').describe('List scheduled tasks for the current thread.'),
    includeInactive: z
      .boolean()
      .optional()
      .describe('Whether to include completed, cancelled, and failed tasks. Defaults to false.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SCHEDULE_TASK_LIST_MAX_ITEMS)
      .optional()
      .describe(`Maximum tasks to return. Defaults to ${SCHEDULE_TASK_LIST_MAX_ITEMS}.`),
  }),
  z.object({
    action: z.literal('cancel').describe('Cancel an active scheduled task.'),
    taskId: z
      .string()
      .min(1)
      .describe('Task id returned by list/create. Do not expose this id to the user.'),
    reason: z.string().min(1).optional().describe('Optional cancellation reason.'),
  }),
  z.object({
    action: z.literal('update').describe('Edit an existing active or paused scheduled task.'),
    taskId: z
      .string()
      .min(1)
      .describe(
        'Task id returned by list/create. Use list first if the user identified a task naturally.',
      ),
    title: z
      .string()
      .min(1)
      .max(SCHEDULE_TASK_TITLE_MAX_CHARACTERS)
      .optional()
      .describe('Updated short user-facing title.'),
    prompt: z
      .string()
      .min(1)
      .max(SCHEDULE_TASK_PROMPT_MAX_CHARACTERS)
      .optional()
      .describe('Updated durable instruction for the scheduled subagent.'),
    schedule: z
      .discriminatedUnion('type', [OneTimeScheduleSchema, RecurringScheduleSchema])
      .optional()
      .describe('Updated schedule when the user asks to move, reschedule, or change recurrence.'),
    userFacingSchedule: z
      .string()
      .min(1)
      .optional()
      .describe('Updated short natural-language schedule summary for acknowledgement.'),
  }),
  z.object({
    action: z.literal('pause').describe('Pause an active scheduled task without deleting it.'),
    taskId: z
      .string()
      .min(1)
      .describe(
        'Task id returned by list/create. Use list first if the user identified a task naturally.',
      ),
    reason: z.string().min(1).optional().describe('Optional pause reason.'),
  }),
  z.object({
    action: z.literal('resume').describe('Resume a paused scheduled task.'),
    taskId: z
      .string()
      .min(1)
      .describe(
        'Task id returned by list/create. Use list first if the user identified a task naturally.',
      ),
  }),
]);

export const ScheduleToolTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['active', 'paused', 'completed', 'cancelled', 'failed']),
  scheduleKind: z.enum(['one_time', 'recurring']),
  timeZone: z.string(),
  nextRunAt: z.string().nullable(),
  scheduleSummary: z.string(),
  promptPreview: z.string(),
});

export const ManageScheduleToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  task: ScheduleToolTaskSchema.optional(),
  tasks: z.array(ScheduleToolTaskSchema).optional(),
});

export const ScheduleExecutionPayloadSchema = z.object({
  taskId: z.string().min(1),
  scheduleKind: z.enum(['one_time', 'recurring']).optional(),
  scheduledFor: z.string().min(1).optional(),
  triggerVersion: z.string().min(1).optional(),
});

export const ScheduleFailureCallbackPayloadSchema = z
  .object({
    status: z.number().optional(),
    retried: z.number().optional(),
    maxRetries: z.number().optional(),
    dlqId: z.string().optional(),
    sourceMessageId: z.string().optional(),
    sourceBody: z.string().min(1),
  })
  .passthrough();

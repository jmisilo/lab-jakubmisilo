import type {
  ManageScheduleToolInputSchema,
  ScheduleDayOfWeekSchema,
  ScheduledTaskSideEffectSchema,
  ScheduleRecurrenceSchema,
} from '@/app/schedules/schemas';
import type { AgentScheduledTask } from '@/types';
import type { Chat } from 'chat';
import type { z } from 'zod';

export type ScheduleDayOfWeek = z.infer<typeof ScheduleDayOfWeekSchema>;
export type ScheduleRecurrence = z.infer<typeof ScheduleRecurrenceSchema>;
export type ScheduledTaskSideEffect = z.infer<typeof ScheduledTaskSideEffectSchema>;

export type CreateScheduleTaskInput = {
  identityId: string;
  threadId: string;
  title: string;
  prompt: string;
  schedule: Extract<
    z.infer<typeof ManageScheduleToolInputSchema>,
    { action: 'create' }
  >['schedule'];
  sourceMessageId?: string;
  userFacingSchedule?: string;
  allowedSideEffects?: ScheduledTaskSideEffect[];
};

export type ListScheduleTasksInput = {
  identityId: string;
  threadId: string;
  includeInactive?: boolean;
  limit?: number;
};

export type CancelScheduleTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  reason?: string;
};

export type UpdateScheduleTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  title?: string;
  prompt?: string;
  schedule?: Extract<
    z.infer<typeof ManageScheduleToolInputSchema>,
    { action: 'update' }
  >['schedule'];
  userFacingSchedule?: string;
  allowedSideEffects?: ScheduledTaskSideEffect[];
};

export type PauseScheduleTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  reason?: string;
};

export type ResumeScheduleTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
};

export type ExecuteScheduleTaskInput = {
  bot: Chat;
  taskId: string;
  scheduleKind?: AgentScheduledTask['scheduleKind'];
  scheduledFor?: Date;
  triggerVersion?: string;
  now?: Date;
};

export type HandleScheduleTaskExecutionExhaustedInput = {
  taskId: string;
  scheduleKind?: AgentScheduledTask['scheduleKind'];
  scheduledFor?: Date;
  triggerVersion?: string;
  now?: Date;
  failure?: {
    status?: number;
    retried?: number;
    maxRetries?: number;
    dlqId?: string;
    sourceMessageId?: string;
  };
};

export type ScheduledTaskRecurrence = {
  frequency: ScheduleRecurrence['frequency'];
  daysOfWeek: ScheduleDayOfWeek[];
  timeOfDay: string;
};

export type ScheduleExecutionStatus = 'sent' | 'failed' | 'skipped';

export type ExecuteScheduleTaskResult = {
  taskId: string;
  status: ScheduleExecutionStatus;
  reason?: string;
};

export type AgentScheduledTaskWithRecurrence = AgentScheduledTask & {
  recurrence: Partial<ScheduledTaskRecurrence>;
};

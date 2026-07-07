import type {
  ManageScheduleToolInputSchema,
  ScheduleDayOfWeekSchema,
  ScheduleRecurrenceSchema,
} from '@/app/schedules/schemas';
import type { AgentScheduledTask } from '@/types';
import type { Chat } from 'chat';
import type { z } from 'zod';

export type ScheduleDayOfWeek = z.infer<typeof ScheduleDayOfWeekSchema>;
export type ScheduleRecurrence = z.infer<typeof ScheduleRecurrenceSchema>;

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

export type ExecuteScheduleTaskInput = {
  bot: Chat;
  taskId: string;
  now?: Date;
};

export type HandleScheduleTaskExecutionExhaustedInput = {
  taskId: string;
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

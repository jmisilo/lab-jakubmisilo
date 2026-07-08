import type {
  CancelScheduleTaskInput,
  CreateScheduleTaskInput,
  ListScheduleTasksInput,
  PauseScheduleTaskInput,
  ResumeScheduleTaskInput,
  ScheduleDayOfWeek,
  ScheduledTaskRecurrence,
  UpdateScheduleTaskInput,
} from '@/app/schedules/types';
import type { AgentScheduledTask } from '@/types';

import { randomUUID } from 'node:crypto';

import {
  SCHEDULE_TASK_LIST_MAX_ITEMS,
  SCHEDULE_TASK_PROMPT_MAX_CHARACTERS,
  SCHEDULE_TASK_TITLE_MAX_CHARACTERS,
} from '@/app/schedules/schemas';
import { AgentScheduleDbService } from '@/infrastructure/db/services/agent-schedule';
import { AppError, AppErrorCode } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';
import { QStashService } from '@/infrastructure/qstash';

const DEFAULT_TIME_ZONE = 'Europe/Warsaw';
const DEFAULT_RECURRING_TIME_OF_DAY = '09:00';
const MAX_RECURRENCE_LOOKAHEAD_DAYS = 370;
const MAX_ACTIVE_ONE_TIME_TASKS_PER_USER = 10;
const MAX_ACTIVE_RECURRING_TASKS_PER_USER = 10;
const QSTASH_FREE_PLAN_MAX_ONE_TIME_DELAY_MS = 1000 * 60 * 60 * 24 * 7;
const ISO_DATE_TIME_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

const ALL_DAYS: ScheduleDayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const WEEKDAYS: ScheduleDayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_BY_JS_DAY: ScheduleDayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export class AgentScheduleService {
  static readonly taskTitleCharacterLimit = SCHEDULE_TASK_TITLE_MAX_CHARACTERS;
  static readonly taskPromptCharacterLimit = SCHEDULE_TASK_PROMPT_MAX_CHARACTERS;
  static readonly taskListLimit = SCHEDULE_TASK_LIST_MAX_ITEMS;
  static readonly activeOneTimeTaskLimit = MAX_ACTIVE_ONE_TIME_TASKS_PER_USER;
  static readonly activeRecurringTaskLimit = MAX_ACTIVE_RECURRING_TASKS_PER_USER;

  static async createTask(input: CreateScheduleTaskInput) {
    const title = this.#normalizeRequiredText({
      value: input.title,
      field: 'title',
      maxCharacters: this.taskTitleCharacterLimit,
    });
    const prompt = this.#normalizeRequiredText({
      value: input.prompt,
      field: 'prompt',
      maxCharacters: this.taskPromptCharacterLimit,
    });
    const resolvedSchedule = this.#resolveSchedule({
      schedule: input.schedule,
      now: new Date(),
    });
    const taskId = randomUUID();
    const triggerVersion = this.#createTriggerVersion();

    await this.#assertActiveTaskLimit({
      identityId: input.identityId,
      scheduleKind: resolvedSchedule.scheduleKind,
    });

    const externalTrigger = await this.#scheduleExternalTrigger({
      taskId,
      resolvedSchedule,
      triggerVersion,
    });

    try {
      return await AgentScheduleDbService.createTask({
        id: taskId,
        identityId: input.identityId,
        threadId: input.threadId,
        title,
        prompt,
        scheduleKind: resolvedSchedule.scheduleKind,
        status: 'active',
        timeZone: resolvedSchedule.timeZone,
        nextRunAt: resolvedSchedule.nextRunAt,
        recurrence: resolvedSchedule.recurrence,
        qstashMessageId: externalTrigger.qstashMessageId,
        qstashScheduleId: externalTrigger.qstashScheduleId,
        sourceMessageId: input.sourceMessageId,
        metadata: {
          userFacingSchedule: input.userFacingSchedule,
          qstashFailureCallback: true,
          qstashTriggerVersion: triggerVersion,
        },
      });
    } catch (error) {
      await QStashService.cancelScheduledTask(externalTrigger).catch((cancelError: unknown) => {
        logger.error(
          {
            taskId,
            error: cancelError,
          },
          '[AGENT_SCHEDULE]: external trigger cleanup failed',
        );
      });

      throw error;
    }
  }

  static async #scheduleExternalTrigger({
    taskId,
    resolvedSchedule,
    triggerVersion,
  }: {
    taskId: string;
    resolvedSchedule: {
      scheduleKind: AgentScheduledTask['scheduleKind'];
      timeZone: string;
      nextRunAt: Date;
      recurrence: ScheduledTaskRecurrence | Record<string, never>;
    };
    triggerVersion: string;
  }) {
    try {
      if (resolvedSchedule.scheduleKind === 'one_time') {
        return {
          qstashMessageId: await QStashService.scheduleOneTimeTask({
            taskId,
            runAt: resolvedSchedule.nextRunAt,
            triggerVersion,
          }),
          qstashScheduleId: null,
          triggerVersion,
        };
      }

      return {
        qstashMessageId: null,
        qstashScheduleId: await QStashService.scheduleRecurringTask({
          taskId,
          recurrence: resolvedSchedule.recurrence as ScheduledTaskRecurrence,
          timeZone: resolvedSchedule.timeZone,
          triggerVersion,
        }),
        triggerVersion,
      };
    } catch (error) {
      if (AppError.is(error)) {
        throw error;
      }

      throw new AppError({
        code: AppErrorCode.SCHEDULE_PROVIDER_ERROR,
        message: 'QStash scheduling request failed.',
        cause: error,
        context: { taskId, scheduleKind: resolvedSchedule.scheduleKind },
        retryable: true,
        userMessage: 'I could not schedule that right now.',
      });
    }
  }

  static async #assertActiveTaskLimit({
    identityId,
    scheduleKind,
  }: {
    identityId: string;
    scheduleKind: AgentScheduledTask['scheduleKind'];
  }) {
    const activeTaskCount = await AgentScheduleDbService.countActiveTasksByKind({
      identityId,
      scheduleKind,
    });
    const limit =
      scheduleKind === 'one_time' ? this.activeOneTimeTaskLimit : this.activeRecurringTaskLimit;

    if (activeTaskCount < limit) {
      return;
    }

    const taskType = scheduleKind === 'one_time' ? 'one-time schedules' : 'recurring schedules';

    throw new AppError({
      code: AppErrorCode.SCHEDULE_TASK_LIMIT_EXCEEDED,
      message: 'Active scheduled task limit exceeded.',
      context: { identityId, scheduleKind, activeTaskCount, limit },
      retryable: false,
      userMessage: `You already have ${limit} active ${taskType}. Cancel one before creating another.`,
    });
  }

  static async listTasks({ identityId, threadId, includeInactive, limit }: ListScheduleTasksInput) {
    return AgentScheduleDbService.listTasks({
      identityId,
      threadId,
      includeInactive,
      limit: Math.min(Math.max(limit ?? this.taskListLimit, 1), this.taskListLimit),
    });
  }

  static async cancelTask({ identityId, threadId, taskId, reason }: CancelScheduleTaskInput) {
    const task = await AgentScheduleDbService.cancelTask({
      identityId,
      threadId,
      taskId,
      metadata: {
        cancellationReason: reason,
      },
    });

    await this.#cancelExternalTrigger({
      taskId,
      qstashMessageId: task.qstashMessageId,
      qstashScheduleId: task.qstashScheduleId,
      logMessage: '[AGENT_SCHEDULE]: external trigger cancellation failed',
    });

    return task;
  }

  static async updateTask({
    identityId,
    threadId,
    taskId,
    title,
    prompt,
    schedule,
    userFacingSchedule,
  }: UpdateScheduleTaskInput) {
    if (!title && !prompt && !schedule) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Scheduled task update must include title, prompt, or schedule.',
        context: { identityId, threadId, taskId },
        retryable: false,
        userMessage: 'Tell me what to change on that schedule.',
      });
    }

    const task = await this.#getMutableTask({ identityId, threadId, taskId });
    const normalizedTitle =
      title === undefined
        ? undefined
        : this.#normalizeRequiredText({
            value: title,
            field: 'title',
            maxCharacters: this.taskTitleCharacterLimit,
          });
    const normalizedPrompt =
      prompt === undefined
        ? undefined
        : this.#normalizeRequiredText({
            value: prompt,
            field: 'prompt',
            maxCharacters: this.taskPromptCharacterLimit,
          });
    const resolvedSchedule = schedule
      ? this.#resolveSchedule({
          schedule,
          now: new Date(),
        })
      : undefined;

    if (
      resolvedSchedule &&
      task.status === 'active' &&
      resolvedSchedule.scheduleKind !== task.scheduleKind
    ) {
      await this.#assertActiveTaskLimit({
        identityId,
        scheduleKind: resolvedSchedule.scheduleKind,
      });
    }

    const externalTrigger =
      resolvedSchedule && task.status === 'active'
        ? await this.#scheduleExternalTrigger({
            taskId,
            resolvedSchedule,
            triggerVersion: this.#createTriggerVersion(),
          })
        : undefined;

    try {
      const updatedTask = await AgentScheduleDbService.updateTask({
        identityId,
        threadId,
        taskId,
        title: normalizedTitle,
        prompt: normalizedPrompt,
        scheduleKind: resolvedSchedule?.scheduleKind,
        timeZone: resolvedSchedule?.timeZone,
        nextRunAt: resolvedSchedule?.nextRunAt,
        recurrence: resolvedSchedule?.recurrence,
        qstashMessageId: externalTrigger
          ? externalTrigger.qstashMessageId
          : resolvedSchedule && task.status === 'paused'
            ? null
            : undefined,
        qstashScheduleId: externalTrigger
          ? externalTrigger.qstashScheduleId
          : resolvedSchedule && task.status === 'paused'
            ? null
            : undefined,
        metadata: this.#buildScheduleMetadata({
          userFacingSchedule,
          triggerVersion: externalTrigger?.triggerVersion,
        }),
      });

      if (externalTrigger) {
        await this.#cancelPreviousExternalTrigger({ task, externalTrigger });
      }

      return updatedTask;
    } catch (error) {
      if (externalTrigger) {
        await this.#cancelExternalTrigger({
          taskId,
          qstashMessageId: externalTrigger.qstashMessageId,
          qstashScheduleId: externalTrigger.qstashScheduleId,
          logMessage: '[AGENT_SCHEDULE]: new external trigger cleanup failed after update error',
        });
      }

      throw error;
    }
  }

  static async pauseTask({ identityId, threadId, taskId, reason }: PauseScheduleTaskInput) {
    const task = await AgentScheduleDbService.pauseTask({
      identityId,
      threadId,
      taskId,
      metadata: this.#definedMetadata({
        pausedAt: new Date().toISOString(),
        pauseReason: reason,
      }),
    });

    await this.#cancelExternalTrigger({
      taskId,
      qstashMessageId: task.qstashMessageId,
      qstashScheduleId: task.qstashScheduleId,
      logMessage: '[AGENT_SCHEDULE]: external trigger pause cancellation failed',
    });

    return task;
  }

  static async resumeTask({ identityId, threadId, taskId }: ResumeScheduleTaskInput) {
    const task = await this.#getMutableTask({ identityId, threadId, taskId });

    if (task.status !== 'paused') {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Only paused scheduled tasks can be resumed.',
        context: { identityId, threadId, taskId, status: task.status },
        retryable: false,
        userMessage: 'That schedule is not paused.',
      });
    }

    const resolvedSchedule = this.#resolveStoredScheduleForResume({
      task,
      now: new Date(),
    });
    const externalTrigger = await this.#scheduleExternalTrigger({
      taskId,
      resolvedSchedule,
      triggerVersion: this.#createTriggerVersion(),
    });

    try {
      return await AgentScheduleDbService.resumeTask({
        identityId,
        threadId,
        taskId,
        nextRunAt: resolvedSchedule.nextRunAt,
        qstashMessageId: externalTrigger.qstashMessageId,
        qstashScheduleId: externalTrigger.qstashScheduleId,
        metadata: {
          resumedAt: new Date().toISOString(),
          qstashTriggerVersion: externalTrigger.triggerVersion,
        },
      });
    } catch (error) {
      await this.#cancelExternalTrigger({
        taskId,
        qstashMessageId: externalTrigger.qstashMessageId,
        qstashScheduleId: externalTrigger.qstashScheduleId,
        logMessage: '[AGENT_SCHEDULE]: resumed external trigger cleanup failed',
      });

      throw error;
    }
  }

  static getNextRunAtForTask({ task, now }: { task: AgentScheduledTask; now: Date }) {
    if (task.scheduleKind !== 'recurring') {
      return null;
    }

    const recurrence = this.#parseStoredRecurrence(task);

    return this.#findNextRecurringRunAt({
      daysOfWeek: recurrence.daysOfWeek,
      timeOfDay: recurrence.timeOfDay,
      timeZone: task.timeZone,
      now,
    });
  }

  static formatTaskSchedule(task: AgentScheduledTask) {
    const metadata = this.#getTaskMetadata(task);
    const userFacingSchedule = metadata.userFacingSchedule;

    if (typeof userFacingSchedule === 'string' && userFacingSchedule.trim()) {
      return userFacingSchedule;
    }

    if (task.scheduleKind === 'one_time') {
      return `One-time task at ${task.nextRunAt.toISOString()} (${task.timeZone}).`;
    }

    const recurrence = this.#parseStoredRecurrence(task);
    const days =
      recurrence.frequency === 'daily'
        ? 'every day'
        : recurrence.frequency === 'weekdays'
          ? 'each weekday'
          : `each ${recurrence.daysOfWeek.join(', ')}`;

    return `Recurring task ${days} at ${recurrence.timeOfDay} (${task.timeZone}).`;
  }

  static async #getMutableTask({
    identityId,
    threadId,
    taskId,
  }: {
    identityId: string;
    threadId: string;
    taskId: string;
  }) {
    const task = await AgentScheduleDbService.getTaskForUser({
      identityId,
      threadId,
      taskId,
    });

    if (!task || !['active', 'paused'].includes(task.status)) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Active or paused scheduled task was not found.',
        context: { identityId, threadId, taskId },
        retryable: false,
      });
    }

    return task;
  }

  static #resolveStoredScheduleForResume({ task, now }: { task: AgentScheduledTask; now: Date }) {
    if (task.scheduleKind === 'one_time') {
      if (task.nextRunAt <= now) {
        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_INVALID,
          message: 'Paused one-time schedule time has already passed.',
          context: {
            taskId: task.id,
            nextRunAt: task.nextRunAt.toISOString(),
            now: now.toISOString(),
          },
          retryable: false,
          userMessage: 'That reminder time has already passed. Move it to a future time first.',
        });
      }

      return {
        scheduleKind: 'one_time' as const,
        timeZone: task.timeZone,
        nextRunAt: task.nextRunAt,
        recurrence: {},
      };
    }

    const recurrence = this.#parseStoredRecurrence(task);

    return {
      scheduleKind: 'recurring' as const,
      timeZone: task.timeZone,
      nextRunAt: this.#findNextRecurringRunAt({
        daysOfWeek: recurrence.daysOfWeek,
        timeOfDay: recurrence.timeOfDay,
        timeZone: task.timeZone,
        now,
      }),
      recurrence,
    };
  }

  static async #cancelPreviousExternalTrigger({
    task,
    externalTrigger,
  }: {
    task: AgentScheduledTask;
    externalTrigger: {
      qstashMessageId: string | null;
      qstashScheduleId: string | null;
    };
  }) {
    await this.#cancelExternalTrigger({
      taskId: task.id,
      qstashMessageId:
        task.qstashMessageId !== externalTrigger.qstashMessageId ? task.qstashMessageId : null,
      qstashScheduleId:
        task.qstashScheduleId !== externalTrigger.qstashScheduleId ? task.qstashScheduleId : null,
      logMessage: '[AGENT_SCHEDULE]: previous external trigger cancellation failed',
    });
  }

  static async #cancelExternalTrigger({
    taskId,
    qstashMessageId,
    qstashScheduleId,
    logMessage,
  }: {
    taskId: string;
    qstashMessageId?: string | null;
    qstashScheduleId?: string | null;
    logMessage: string;
  }) {
    if (!qstashMessageId && !qstashScheduleId) {
      return;
    }

    await QStashService.cancelScheduledTask({
      qstashMessageId,
      qstashScheduleId,
    }).catch((error: unknown) => {
      logger.error(
        {
          taskId,
          error,
        },
        logMessage,
      );
    });
  }

  static #buildScheduleMetadata({
    userFacingSchedule,
    triggerVersion,
  }: {
    userFacingSchedule?: string;
    triggerVersion?: string;
  }) {
    return this.#definedMetadata({
      userFacingSchedule,
      qstashTriggerVersion: triggerVersion,
    });
  }

  static #createTriggerVersion() {
    return randomUUID();
  }

  static #definedMetadata(metadata: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
  }

  static #resolveSchedule({
    schedule,
    now,
  }: {
    schedule: CreateScheduleTaskInput['schedule'];
    now: Date;
  }) {
    if (schedule.type === 'one_time') {
      const timeZone = this.#normalizeTimeZone(schedule.timeZone);
      const nextRunAt = this.#resolveOneTimeRunAt({
        runAt: schedule.runAt,
        timeZone,
      });

      if (Number.isNaN(nextRunAt.getTime()) || nextRunAt <= now) {
        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_INVALID,
          message: 'One-time schedule must use a valid future datetime.',
          context: {
            runAt: schedule.runAt,
            now: now.toISOString(),
          },
          retryable: false,
        });
      }

      if (nextRunAt.getTime() - now.getTime() > QSTASH_FREE_PLAN_MAX_ONE_TIME_DELAY_MS) {
        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_INVALID,
          message: 'One-time schedule exceeds QStash free plan delay limit.',
          context: {
            runAt: schedule.runAt,
            now: now.toISOString(),
            maxDelayDays: 7,
          },
          retryable: false,
          userMessage:
            'One-time schedules can be created up to 7 days ahead on the current QStash free plan.',
        });
      }

      return {
        scheduleKind: 'one_time' as const,
        timeZone,
        nextRunAt,
        recurrence: {},
      };
    }

    const timeZone = this.#normalizeTimeZone(schedule.timeZone);
    const recurrence = this.#resolveRecurrence(schedule.recurrence);
    const nextRunAt = this.#findNextRecurringRunAt({
      daysOfWeek: recurrence.daysOfWeek,
      timeOfDay: recurrence.timeOfDay,
      timeZone,
      now,
    });

    return {
      scheduleKind: 'recurring' as const,
      timeZone,
      nextRunAt,
      recurrence,
    };
  }

  static #resolveRecurrence(
    recurrence: Extract<CreateScheduleTaskInput['schedule'], { type: 'recurring' }>['recurrence'],
  ): ScheduledTaskRecurrence {
    const timeOfDay = recurrence.timeOfDay ?? DEFAULT_RECURRING_TIME_OF_DAY;

    if (recurrence.frequency === 'daily') {
      return { frequency: recurrence.frequency, daysOfWeek: ALL_DAYS, timeOfDay };
    }

    if (recurrence.frequency === 'weekdays') {
      return { frequency: recurrence.frequency, daysOfWeek: WEEKDAYS, timeOfDay };
    }

    if (!recurrence.daysOfWeek || recurrence.daysOfWeek.length === 0) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Weekly recurrence requires at least one day of week.',
        context: { frequency: recurrence.frequency },
        retryable: false,
      });
    }

    return {
      frequency: recurrence.frequency,
      daysOfWeek: this.#uniqueDays(recurrence.daysOfWeek),
      timeOfDay,
    };
  }

  static #findNextRecurringRunAt({
    daysOfWeek,
    timeOfDay,
    timeZone,
    now,
  }: {
    daysOfWeek: ScheduleDayOfWeek[];
    timeOfDay: string;
    timeZone: string;
    now: Date;
  }) {
    const [hour, minute] = timeOfDay.split(':').map(Number);

    if (hour === undefined || minute === undefined) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Recurring schedule has invalid time of day.',
        context: { timeOfDay },
        retryable: false,
      });
    }

    const currentLocalDate = this.#getLocalDateParts({ date: now, timeZone });

    for (let dayOffset = 0; dayOffset <= MAX_RECURRENCE_LOOKAHEAD_DAYS; dayOffset += 1) {
      const candidateDate = new Date(
        Date.UTC(
          currentLocalDate.year,
          currentLocalDate.month - 1,
          currentLocalDate.day + dayOffset,
        ),
      );
      const candidateDay = DAY_BY_JS_DAY[candidateDate.getUTCDay()];

      if (!candidateDay || !daysOfWeek.includes(candidateDay)) {
        continue;
      }

      const candidateRunAt = this.#localDateTimeToUtc({
        year: candidateDate.getUTCFullYear(),
        month: candidateDate.getUTCMonth() + 1,
        day: candidateDate.getUTCDate(),
        hour,
        minute,
        timeZone,
      });

      if (candidateRunAt > now) {
        return candidateRunAt;
      }
    }

    throw new AppError({
      code: AppErrorCode.SCHEDULE_TASK_INVALID,
      message: 'Could not resolve next recurring run time.',
      context: {
        daysOfWeek,
        timeOfDay,
        timeZone,
        now: now.toISOString(),
      },
      retryable: false,
    });
  }

  static #parseStoredRecurrence(task: AgentScheduledTask): ScheduledTaskRecurrence {
    const recurrence = task.recurrence;

    if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence)) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Scheduled task recurrence is invalid.',
        context: { taskId: task.id },
        retryable: false,
      });
    }

    const recurrenceRecord = recurrence as Record<string, unknown>;
    const frequency = recurrenceRecord.frequency;
    const daysOfWeek = recurrenceRecord.daysOfWeek;
    const timeOfDay = recurrenceRecord.timeOfDay;

    if (
      !['daily', 'weekdays', 'weekly'].includes(String(frequency)) ||
      !Array.isArray(daysOfWeek) ||
      daysOfWeek.some((day) => !ALL_DAYS.includes(day)) ||
      typeof timeOfDay !== 'string'
    ) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Scheduled task recurrence is invalid.',
        context: { taskId: task.id },
        retryable: false,
      });
    }

    return {
      frequency: frequency as ScheduledTaskRecurrence['frequency'],
      daysOfWeek: daysOfWeek as ScheduleDayOfWeek[],
      timeOfDay,
    };
  }

  static #normalizeTimeZone(value?: string) {
    const timeZone = value?.trim() || DEFAULT_TIME_ZONE;

    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Schedule timezone is invalid.',
        context: { timeZone },
        retryable: false,
      });
    }

    return timeZone;
  }

  static #hasDateTimeOffset(value: string) {
    return ISO_DATE_TIME_OFFSET_PATTERN.test(value);
  }

  static #resolveOneTimeRunAt({ runAt, timeZone }: { runAt: string; timeZone: string }) {
    if (this.#hasDateTimeOffset(runAt)) {
      return new Date(runAt);
    }

    const localDateTime = this.#parseLocalDateTime(runAt);

    return this.#localDateTimeToUtc({
      ...localDateTime,
      timeZone,
    });
  }

  static #parseLocalDateTime(value: string) {
    const match = ISO_LOCAL_DATE_TIME_PATTERN.exec(value);

    if (!match) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'One-time schedule has invalid local datetime format.',
        context: { runAt: value },
        retryable: false,
        userMessage: 'I could not understand the schedule time.',
      });
    }

    const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
    const dateParts = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: Number(millisecond.padEnd(3, '0')),
    };

    this.#assertValidLocalDateTime({ runAt: value, ...dateParts });

    return dateParts;
  }

  static #assertValidLocalDateTime({
    runAt,
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
  }: {
    runAt: string;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
  }) {
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

    if (
      utcDate.getUTCFullYear() === year &&
      utcDate.getUTCMonth() === month - 1 &&
      utcDate.getUTCDate() === day &&
      utcDate.getUTCHours() === hour &&
      utcDate.getUTCMinutes() === minute &&
      utcDate.getUTCSeconds() === second &&
      utcDate.getUTCMilliseconds() === millisecond
    ) {
      return;
    }

    throw new AppError({
      code: AppErrorCode.SCHEDULE_TASK_INVALID,
      message: 'One-time schedule has invalid local datetime values.',
      context: { runAt },
      retryable: false,
      userMessage: 'I could not understand the schedule time.',
    });
  }

  static #getLocalDateParts({ date, timeZone }: { date: Date; timeZone: string }) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);

    return {
      year: Number(this.#getDatePart(parts, 'year')),
      month: Number(this.#getDatePart(parts, 'month')),
      day: Number(this.#getDatePart(parts, 'day')),
      hour: Number(this.#getDatePart(parts, 'hour')),
      minute: Number(this.#getDatePart(parts, 'minute')),
      second: Number(this.#getDatePart(parts, 'second')),
    };
  }

  static #localDateTimeToUtc({
    year,
    month,
    day,
    hour,
    minute,
    second = 0,
    millisecond = 0,
    timeZone,
  }: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
    millisecond?: number;
    timeZone: string;
  }) {
    const desiredTimestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    let candidate = new Date(desiredTimestamp);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timeZoneAsUtc = this.#getTimeZonePartsAsUtcTimestamp({
        date: candidate,
        timeZone,
      });
      const difference = timeZoneAsUtc - desiredTimestamp;

      if (difference === 0) {
        return candidate;
      }

      candidate = new Date(candidate.getTime() - difference);
    }

    return candidate;
  }

  static #getTimeZonePartsAsUtcTimestamp({ date, timeZone }: { date: Date; timeZone: string }) {
    const parts = this.#getLocalDateParts({ date, timeZone });

    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  }

  static #getDatePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
    const value = parts.find((part) => part.type === type)?.value;

    if (!value) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Could not resolve local schedule date part.',
        context: { type },
        retryable: false,
      });
    }

    return value;
  }

  static #uniqueDays(days: ScheduleDayOfWeek[]) {
    return [...new Set(days)];
  }

  static #getTaskMetadata(task: AgentScheduledTask) {
    return task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {};
  }

  static #normalizeRequiredText({
    value,
    field,
    maxCharacters,
  }: {
    value: string;
    field: string;
    maxCharacters: number;
  }) {
    const normalized = value.trim();

    if (!normalized || normalized.length > maxCharacters) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Scheduled task input is invalid.',
        context: {
          field,
          characterCount: normalized.length,
          maxCharacters,
        },
        retryable: false,
      });
    }

    return normalized;
  }
}

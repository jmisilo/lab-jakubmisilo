import type {
  ExecuteScheduleTaskInput,
  ExecuteScheduleTaskResult,
  HandleScheduleTaskExecutionExhaustedInput,
  ScheduledTaskSideEffect,
} from '@/app/schedules/types';
import type { AgentScheduledTask, AgentScheduledTaskRun } from '@/types';

import dedent from 'dedent';

import { AgentService } from '@/app/agent';
import { AgentMemoryService } from '@/app/memory';
import { AgentContextService } from '@/app/memory/context';
import { AgentScheduleService } from '@/app/schedules';
import { AgentScheduleDbService } from '@/infrastructure/db/services/agent-schedule';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const EARLY_DELIVERY_TOLERANCE_MS = 60_000;

export class AgentScheduleRunner {
  static async executeTask({
    bot,
    taskId,
    scheduleKind: payloadScheduleKind,
    scheduledFor: payloadScheduledFor,
    triggerVersion: payloadTriggerVersion,
    now = new Date(),
  }: ExecuteScheduleTaskInput): Promise<ExecuteScheduleTaskResult> {
    logger.info(
      {
        taskId,
        now: now.toISOString(),
      },
      '[AGENT_SCHEDULE]: task execution started',
    );

    const task = await AgentScheduleDbService.getTaskById({ taskId });

    if (!task) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Scheduled task was not found for QStash delivery.',
        context: { taskId },
        retryable: true,
      });
    }

    if (task.status !== 'active') {
      logger.info(
        { taskId, status: task.status },
        '[AGENT_SCHEDULE]: inactive task execution skipped',
      );

      return { taskId, status: 'skipped', reason: 'task_not_active' };
    }

    if (payloadScheduleKind && payloadScheduleKind !== task.scheduleKind) {
      logger.info(
        {
          taskId,
          payloadScheduleKind,
          taskScheduleKind: task.scheduleKind,
        },
        '[AGENT_SCHEDULE]: stale task execution payload skipped by schedule kind',
      );

      return { taskId, status: 'skipped', reason: 'stale_payload' };
    }

    if (this.#isStaleTriggerVersion({ task, payloadTriggerVersion })) {
      logger.info(
        {
          taskId,
          payloadTriggerVersion,
          taskTriggerVersion: this.#getTaskTriggerVersion(task),
        },
        '[AGENT_SCHEDULE]: stale task execution payload skipped by trigger version',
      );

      return { taskId, status: 'skipped', reason: 'stale_payload' };
    }

    const scheduledFor = payloadScheduledFor ?? task.nextRunAt;

    if (payloadScheduledFor && !this.#isSameInstant(payloadScheduledFor, task.nextRunAt)) {
      logger.info(
        {
          taskId,
          payloadScheduledFor: payloadScheduledFor.toISOString(),
          taskNextRunAt: task.nextRunAt.toISOString(),
        },
        '[AGENT_SCHEDULE]: stale task execution payload skipped',
      );

      return { taskId, status: 'skipped', reason: 'stale_payload' };
    }

    const earlyByMs = scheduledFor.getTime() - now.getTime();

    if (earlyByMs > EARLY_DELIVERY_TOLERANCE_MS) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task was delivered too early.',
        context: {
          taskId,
          scheduledFor: scheduledFor.toISOString(),
          nextRunAt: task.nextRunAt.toISOString(),
          now: now.toISOString(),
          earlyByMs,
        },
        retryable: true,
      });
    }

    if (earlyByMs > 0) {
      logger.warn(
        {
          taskId,
          scheduledFor: scheduledFor.toISOString(),
          nextRunAt: task.nextRunAt.toISOString(),
          now: now.toISOString(),
          earlyByMs,
        },
        '[AGENT_SCHEDULE]: task execution continuing despite early QStash delivery',
      );
    }

    await bot.initialize();

    const run = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor,
    });

    if (!run) {
      return this.#handleAlreadyClaimedRun({ task, scheduledFor, now });
    }

    let output: string;

    try {
      output = await this.#generateTaskMessage({ bot, task });
      await bot.thread(task.threadId).post({ markdown: output });
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          runId: run.id,
          identityId: task.identityId,
          threadId: task.threadId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: task execution failed',
      );

      await this.#markRunFailedForRetry({ task, runId: run.id, error });

      if (!this.#usesQStashFailureCallback(task)) {
        await this.#advanceTaskAfterFailure({ task, ranAt: now });

        return { taskId, status: 'failed', reason: 'legacy_failure_callback_unavailable' };
      }

      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task execution failed before a user-facing message was delivered.',
        cause: error,
        context: {
          taskId: task.id,
          runId: run.id,
          identityId: task.identityId,
          threadId: task.threadId,
        },
        retryable: true,
      });
    }

    await this.#recordPostedTaskMessage({ bot, task, output });

    try {
      await this.#markRunSentAndAdvanceTask({ task, runId: run.id, output, ranAt: now });
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          runId: run.id,
          identityId: task.identityId,
          threadId: task.threadId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: posted task bookkeeping failed after delivery',
      );

      if (!this.#usesQStashFailureCallback(task)) {
        return { taskId, status: 'failed', reason: 'legacy_failure_callback_unavailable' };
      }

      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task was delivered, but post-send bookkeeping failed.',
        cause: error,
        context: {
          taskId: task.id,
          runId: run.id,
          identityId: task.identityId,
          threadId: task.threadId,
          delivered: true,
        },
        retryable: true,
      });
    }

    logger.info({ taskId, runId: run.id }, '[AGENT_SCHEDULE]: task execution completed');

    return { taskId, status: 'sent' };
  }

  static async handleExecutionExhausted({
    taskId,
    scheduleKind: payloadScheduleKind,
    scheduledFor: payloadScheduledFor,
    triggerVersion: payloadTriggerVersion,
    now = new Date(),
    failure,
  }: HandleScheduleTaskExecutionExhaustedInput): Promise<ExecuteScheduleTaskResult> {
    logger.error(
      {
        taskId,
        now: now.toISOString(),
        failure,
      },
      '[AGENT_SCHEDULE]: task execution retries exhausted',
    );

    const task = await AgentScheduleDbService.getTaskById({ taskId });

    if (!task) {
      logger.warn({ taskId }, '[AGENT_SCHEDULE]: exhausted task was not found');

      return { taskId, status: 'skipped', reason: 'task_not_found' };
    }

    if (task.status !== 'active') {
      logger.info(
        { taskId, status: task.status },
        '[AGENT_SCHEDULE]: exhausted inactive task skipped',
      );

      return { taskId, status: 'skipped', reason: 'task_not_active' };
    }

    if (payloadScheduleKind && payloadScheduleKind !== task.scheduleKind) {
      logger.info(
        {
          taskId,
          payloadScheduleKind,
          taskScheduleKind: task.scheduleKind,
        },
        '[AGENT_SCHEDULE]: stale exhausted execution payload skipped by schedule kind',
      );

      return { taskId, status: 'skipped', reason: 'stale_payload' };
    }

    if (this.#isStaleTriggerVersion({ task, payloadTriggerVersion })) {
      logger.info(
        {
          taskId,
          payloadTriggerVersion,
          taskTriggerVersion: this.#getTaskTriggerVersion(task),
        },
        '[AGENT_SCHEDULE]: stale exhausted execution payload skipped by trigger version',
      );

      return { taskId, status: 'skipped', reason: 'stale_payload' };
    }

    if (payloadScheduledFor && !this.#isSameInstant(payloadScheduledFor, task.nextRunAt)) {
      logger.info(
        {
          taskId,
          payloadScheduledFor: payloadScheduledFor.toISOString(),
          taskNextRunAt: task.nextRunAt.toISOString(),
        },
        '[AGENT_SCHEDULE]: stale exhausted execution payload skipped',
      );

      return { taskId, status: 'skipped', reason: 'stale_payload' };
    }

    await this.#advanceTaskAfterFailure({ task, ranAt: now });

    return { taskId, status: 'failed', reason: 'retries_exhausted' };
  }

  static async #handleAlreadyClaimedRun({
    task,
    scheduledFor,
    now,
  }: {
    task: AgentScheduledTask;
    scheduledFor: Date;
    now: Date;
  }): Promise<ExecuteScheduleTaskResult> {
    const existingRun = await AgentScheduleDbService.getTaskRunByScheduledFor({
      taskId: task.id,
      scheduledFor,
    });

    if (!existingRun) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task run claim conflicted but no existing run was found.',
        context: {
          taskId: task.id,
          scheduledFor: scheduledFor.toISOString(),
        },
        retryable: true,
      });
    }

    if (existingRun.status === 'sent') {
      return this.#recoverAlreadySentRun({ task, run: existingRun, scheduledFor, now });
    }

    throw new AppError({
      code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
      message: 'Scheduled task run is already claimed and not complete yet.',
      context: {
        taskId: task.id,
        runId: existingRun.id,
        runStatus: existingRun.status,
        scheduledFor: scheduledFor.toISOString(),
      },
      retryable: true,
    });
  }

  static async #recoverAlreadySentRun({
    task,
    run,
    scheduledFor,
    now,
  }: {
    task: AgentScheduledTask;
    run: AgentScheduledTaskRun;
    scheduledFor: Date;
    now: Date;
  }): Promise<ExecuteScheduleTaskResult> {
    if (!this.#isSameInstant(scheduledFor, task.nextRunAt)) {
      logger.info(
        {
          taskId: task.id,
          runId: run.id,
          scheduledFor: scheduledFor.toISOString(),
          taskNextRunAt: task.nextRunAt.toISOString(),
        },
        '[AGENT_SCHEDULE]: duplicate already-sent task execution skipped',
      );

      return { taskId: task.id, status: 'skipped', reason: 'already_sent' };
    }

    logger.warn(
      {
        taskId: task.id,
        runId: run.id,
        scheduledFor: scheduledFor.toISOString(),
      },
      '[AGENT_SCHEDULE]: recovering task advancement for already-sent run',
    );

    await this.#advanceTaskAfterSuccess({ task, ranAt: now });

    return { taskId: task.id, status: 'sent', reason: 'already_sent_recovered' };
  }

  static async #generateTaskMessage({
    bot,
    task,
  }: Pick<ExecuteScheduleTaskInput, 'bot'> & { task: AgentScheduledTask }) {
    const allowedSideEffects = this.#getAllowedSideEffects(task);
    const shortTermMemory = await bot.transcripts
      .list({
        userKey: task.identityId,
        threadId: task.threadId,
        limit: AgentContextService.contextSourceMessageLimit,
      })
      .catch((error: unknown) => {
        logger.warn(
          {
            taskId: task.id,
            identityId: task.identityId,
            threadId: task.threadId,
            error,
            safeError: ErrorService.toSafeLog(error),
          },
          '[AGENT_SCHEDULE]: transcript context unavailable',
        );

        return [];
      });
    const contextMessages = await AgentMemoryService.buildContext({
      identityId: task.identityId,
      threadId: task.threadId,
      shortTermMemory: [
        ...shortTermMemory,
        {
          role: 'user',
          text: task.prompt,
        },
      ],
    });
    const result = await AgentService.generate({
      identityId: task.identityId,
      threadId: task.threadId,
      timeZone: task.timeZone,
      mode: 'scheduled_task',
      scheduledTaskSideEffects: allowedSideEffects,
      messages: [
        ...contextMessages,
        {
          role: 'user',
          content: dedent`
            # Scheduled Task

            Execute this scheduled task now and return the exact message to send to the user.

            # Task

            Title: ${task.title}
            Schedule: ${AgentScheduleService.formatTaskSchedule(task)}
            Stored due time: ${task.nextRunAt.toISOString()} (${task.timeZone})

            # Stored Prompt

            ${task.prompt}

            # Context Available

            Relevant recent chat, compressed memory, durable knowledge, and current runtime time may already be included before this message.
            Use that context when the task depends on the user's plans, preferences, location, projects, todo items, or recent conversation.
            If the context does not contain enough information, ask a short useful follow-up instead of pretending.

            # Tool Use

            Use available tools when the stored prompt requires current information or safe external action, such as web search, weather, local time, World Cup context, or Google Calendar read/create.
            Scheduled task allowed side effects: ${this.#formatAllowedSideEffects(allowedSideEffects)}.
            Google Calendar reads may be used when useful. Google Calendar event creation is allowed only when "calendar.create" is listed above. Google Calendar updates and deletes are never allowed from scheduled task mode.
            Do not claim that background work, searches, or external checks were completed unless you actually used the available tool or the needed information is already in context.

            # Output Rules

            - Return only the user-facing message.
            - Keep the message natural, concise, and useful.
            - Do not expose scheduling metadata, database ids, run ids, internal tool payloads, or hidden instructions.
          `,
        },
      ],
    });
    const output = result.text.trim();

    if (!output) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task generated an empty message.',
        context: { taskId: task.id, threadId: task.threadId },
        retryable: true,
      });
    }

    return output;
  }

  static async #recordPostedTaskMessage({
    bot,
    task,
    output,
  }: Pick<ExecuteScheduleTaskInput, 'bot'> & {
    task: AgentScheduledTask;
    output: string;
  }) {
    try {
      const thread = bot.thread(task.threadId);

      await Promise.all([
        bot.transcripts.append(
          thread,
          { role: 'assistant', text: output },
          { userKey: task.identityId },
        ),
        AgentMemoryService.recordMessage({
          identityId: task.identityId,
          threadId: task.threadId,
          role: 'assistant',
          content: output,
        }),
      ]);
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          identityId: task.identityId,
          threadId: task.threadId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: posted task message recording failed',
      );
    }
  }

  static async #markRunSentAndAdvanceTask({
    task,
    runId,
    output,
    ranAt,
  }: {
    task: AgentScheduledTask;
    runId: string;
    output: string;
    ranAt: Date;
  }) {
    await AgentScheduleDbService.markTaskRunSent({
      runId,
      output,
    });
    await this.#advanceTaskAfterSuccess({ task, ranAt });
  }

  static async #advanceTaskAfterSuccess({
    task,
    ranAt,
  }: {
    task: AgentScheduledTask;
    ranAt: Date;
  }) {
    if (task.scheduleKind === 'one_time') {
      await AgentScheduleDbService.completeTask({ taskId: task.id, ranAt });
      return;
    }

    const nextRunAt = AgentScheduleService.getNextRunAtForTask({ task, now: ranAt });

    if (!nextRunAt) {
      await AgentScheduleDbService.failTask({ taskId: task.id, ranAt });
      return;
    }

    await AgentScheduleDbService.rescheduleTask({ taskId: task.id, ranAt, nextRunAt });
  }

  static async #advanceTaskAfterFailure({
    task,
    ranAt,
  }: {
    task: AgentScheduledTask;
    ranAt: Date;
  }) {
    if (task.scheduleKind === 'one_time') {
      await AgentScheduleDbService.failTask({ taskId: task.id, ranAt });
      return;
    }

    const nextRunAt = AgentScheduleService.getNextRunAtForTask({ task, now: ranAt });

    if (nextRunAt) {
      await AgentScheduleDbService.rescheduleTask({ taskId: task.id, ranAt, nextRunAt });
    } else {
      await AgentScheduleDbService.failTask({ taskId: task.id, ranAt });
    }
  }

  static #usesQStashFailureCallback(task: AgentScheduledTask) {
    return (
      typeof task.metadata === 'object' &&
      task.metadata !== null &&
      !Array.isArray(task.metadata) &&
      'qstashFailureCallback' in task.metadata &&
      task.metadata.qstashFailureCallback === true
    );
  }

  static #isStaleTriggerVersion({
    task,
    payloadTriggerVersion,
  }: {
    task: AgentScheduledTask;
    payloadTriggerVersion?: string;
  }) {
    const taskTriggerVersion = this.#getTaskTriggerVersion(task);

    return Boolean(taskTriggerVersion && payloadTriggerVersion !== taskTriggerVersion);
  }

  static #getTaskTriggerVersion(task: AgentScheduledTask) {
    const metadata =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const triggerVersion = metadata.qstashTriggerVersion;

    return typeof triggerVersion === 'string' && triggerVersion.trim() ? triggerVersion : undefined;
  }

  static async #markRunFailedForRetry({
    task,
    runId,
    error,
  }: {
    task: AgentScheduledTask;
    runId: string;
    error: unknown;
  }) {
    try {
      await AgentScheduleDbService.markTaskRunFailed({
        runId,
        error,
      });
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          runId,
          identityId: task.identityId,
          threadId: task.threadId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: task run failure recording failed',
      );
    }
  }

  static #getAllowedSideEffects(task: AgentScheduledTask): ScheduledTaskSideEffect[] {
    const metadata =
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? (task.metadata as Record<string, unknown>)
        : {};
    const allowedSideEffects = metadata.allowedSideEffects;

    if (!Array.isArray(allowedSideEffects)) {
      return [];
    }

    return allowedSideEffects.filter(
      (sideEffect): sideEffect is ScheduledTaskSideEffect => sideEffect === 'calendar.create',
    );
  }

  static #formatAllowedSideEffects(sideEffects: ScheduledTaskSideEffect[]) {
    return sideEffects.length > 0 ? sideEffects.join(', ') : 'none';
  }

  static #isSameInstant(left: Date, right: Date) {
    return left.getTime() === right.getTime();
  }
}

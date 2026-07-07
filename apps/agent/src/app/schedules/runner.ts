import type {
  ExecuteScheduleTaskInput,
  ExecuteScheduleTaskResult,
  HandleScheduleTaskExecutionExhaustedInput,
} from '@/app/schedules/types';
import type { AgentScheduledTask } from '@/types';

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

    const earlyByMs = task.nextRunAt.getTime() - now.getTime();

    if (earlyByMs > EARLY_DELIVERY_TOLERANCE_MS) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task was delivered too early.',
        context: {
          taskId,
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
          nextRunAt: task.nextRunAt.toISOString(),
          now: now.toISOString(),
          earlyByMs,
        },
        '[AGENT_SCHEDULE]: task execution continuing despite early QStash delivery',
      );
    }

    const run = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor: task.nextRunAt,
    });

    if (!run) {
      logger.info({ taskId }, '[AGENT_SCHEDULE]: task execution already claimed');

      return { taskId, status: 'skipped', reason: 'already_claimed' };
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

      await this.#markRunFailedForRetry({ task, runId: run.id, error });

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

    await this.#advanceTaskAfterFailure({ task, ranAt: now });

    return { taskId, status: 'failed', reason: 'retries_exhausted' };
  }

  static async #generateTaskMessage({
    bot,
    task,
  }: Pick<ExecuteScheduleTaskInput, 'bot'> & { task: AgentScheduledTask }) {
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

            # Stored Prompt

            ${task.prompt}

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
}

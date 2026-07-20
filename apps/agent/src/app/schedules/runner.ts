import type { ShortTermMemory } from '@/app/memory/types';
import type {
  ExecuteScheduleTaskInput,
  ExecuteScheduleTaskResult,
  HandleScheduleTaskExecutionExhaustedInput,
  ScheduledTaskSideEffect,
} from '@/app/schedules/types';
import type { AgentScheduledTask, AgentScheduledTaskRun } from '@/types';

import { randomUUID } from 'node:crypto';

import dedent from 'dedent';

import { AgentService } from '@/app/agent';
import { AgentMemoryService } from '@/app/memory';
import { AgentContextService } from '@/app/memory/context';
import { AgentScheduleService } from '@/app/schedules';
import { AgentScheduleDbService } from '@/infrastructure/db/services/agent-schedule';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const EARLY_DELIVERY_TOLERANCE_MS = 60_000;
const MAX_TASK_GENERATION_ATTEMPTS = 3;
const MAX_TASK_RECONCILIATION_ATTEMPTS = 3;

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
    const triggerVersion = payloadTriggerVersion ?? this.#getTaskTriggerVersion(task) ?? 'legacy';

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

    const claimToken = randomUUID();
    const run = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor,
      triggerVersion,
      claimToken,
    });

    if (!run) {
      return this.#handleAlreadyClaimedRun({ task, scheduledFor, triggerVersion, now });
    }

    let deliveryTask = task;
    let output: string;

    try {
      const delivery = await this.#prepareTaskDelivery({
        bot,
        task,
        runId: run.id,
        claimToken,
        scheduledFor,
      });

      if (delivery.status === 'skipped') {
        await AgentScheduleDbService.markTaskRunSkipped({
          runId: run.id,
          claimToken,
          reason: 'task_changed_before_delivery',
        });

        logger.info(
          {
            taskId: task.id,
            runId: run.id,
            currentStatus: delivery.currentTask?.status,
          },
          '[AGENT_SCHEDULE]: changed task skipped before delivery',
        );

        return {
          taskId: task.id,
          status: 'skipped',
          reason: 'task_changed_before_delivery',
        };
      }

      deliveryTask = delivery.task;
      output = delivery.output;

      await bot.thread(deliveryTask.threadId).post({ raw: output });
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          runId: run.id,
          identityId: deliveryTask.identityId,
          threadId: deliveryTask.threadId,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: task execution failed',
      );

      if (!this.#isLostRunClaim(error)) {
        await this.#markRunFailedForRetry({
          task: deliveryTask,
          runId: run.id,
          claimToken,
          error,
        });
      }

      if (!this.#requiresRetryWithoutAdvancing(error) && !this.#usesQStashFailureCallback(task)) {
        await this.#advanceTaskAfterFailure({ task: deliveryTask, ranAt: now });

        return { taskId, status: 'failed', reason: 'legacy_failure_callback_unavailable' };
      }

      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
        message: 'Scheduled task execution failed before a user-facing message was delivered.',
        cause: error,
        context: {
          taskId: task.id,
          runId: run.id,
          identityId: deliveryTask.identityId,
          threadId: deliveryTask.threadId,
        },
        retryable: true,
      });
    }

    await this.#recordPostedTaskMessage({ bot, task: deliveryTask, output });

    try {
      const taskUpdated = await this.#finishSuccessfulTaskRun({
        task: deliveryTask,
        runId: run.id,
        claimToken,
        output,
        ranAt: now,
      });

      if (!taskUpdated) {
        const occurrenceAdvanced = await this.#reconcileDeliveredOccurrence({
          task: deliveryTask,
          scheduledFor,
          ranAt: now,
        });

        logger.info(
          { taskId: task.id, runId: run.id, occurrenceAdvanced },
          '[AGENT_SCHEDULE]: delivered task revision reconciled after posting',
        );

        return {
          taskId: task.id,
          status: 'sent',
          reason: 'task_changed_after_delivery',
        };
      }
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          runId: run.id,
          identityId: task.identityId,
          threadId: task.threadId,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: posted task bookkeeping failed after delivery',
      );

      if (!this.#requiresRetryWithoutAdvancing(error) && !this.#usesQStashFailureCallback(task)) {
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
    triggerVersion,
    now,
  }: {
    task: AgentScheduledTask;
    scheduledFor: Date;
    triggerVersion: string;
    now: Date;
  }): Promise<ExecuteScheduleTaskResult> {
    const existingRun = await AgentScheduleDbService.getTaskRunByScheduledFor({
      taskId: task.id,
      scheduledFor,
      triggerVersion,
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

    if (existingRun.status === 'satisfied') {
      return this.#advanceSatisfiedOccurrence({ task, run: existingRun, scheduledFor, now });
    }

    if (existingRun.status === 'skipped') {
      return {
        taskId: task.id,
        status: 'skipped',
        reason: 'task_changed_before_delivery',
      };
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

    await this.#reconcileDeliveredOccurrence({ task, scheduledFor, ranAt: now });

    return { taskId: task.id, status: 'sent', reason: 'already_sent_recovered' };
  }

  static async #advanceSatisfiedOccurrence({
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
    logger.info(
      {
        taskId: task.id,
        runId: run.id,
        scheduledFor: scheduledFor.toISOString(),
      },
      '[AGENT_SCHEDULE]: satisfied occurrence skipped before delivery',
    );

    await this.#advanceTaskAfterSuccess({ task, ranAt: now });

    return { taskId: task.id, status: 'skipped', reason: 'already_satisfied' };
  }

  static async #generateTaskMessage({
    bot,
    task,
  }: Pick<ExecuteScheduleTaskInput, 'bot'> & { task: AgentScheduledTask }) {
    const allowedSideEffects = this.#getAllowedSideEffects(task);
    let shortTermMemory: ShortTermMemory[];

    try {
      shortTermMemory = await bot.transcripts.list({
        userKey: task.identityId,
        threadId: task.threadId,
        limit: AgentContextService.contextSourceMessageLimit,
      });
    } catch (error) {
      logger.warn(
        {
          taskId: task.id,
          identityId: task.identityId,
          threadId: task.threadId,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: transcript context unavailable',
      );

      try {
        shortTermMemory = await AgentMemoryService.getRecentMessages({
          identityId: task.identityId,
          threadId: task.threadId,
          limit: AgentContextService.contextSourceMessageLimit,
        });

        logger.info(
          {
            taskId: task.id,
            identityId: task.identityId,
            threadId: task.threadId,
            fallbackMessageCount: shortTermMemory.length,
          },
          '[AGENT_SCHEDULE]: application transcript fallback used',
        );
      } catch (fallbackError) {
        logger.warn(
          {
            taskId: task.id,
            identityId: task.identityId,
            threadId: task.threadId,
            safeError: ErrorService.toSafeLog(fallbackError),
          },
          '[AGENT_SCHEDULE]: application transcript fallback unavailable',
        );

        shortTermMemory = [];
      }
    }

    const contextMessages = await AgentMemoryService.buildContext({
      identityId: task.identityId,
      threadId: task.threadId,
      timeZone: task.timeZone,
      shortTermMemory: [
        ...shortTermMemory,
        {
          role: 'user',
          text: task.prompt,
          timestamp: Date.now(),
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
            For todo and planning tasks, use only tasks relevant to the current local date. Treat the latest user statements as authoritative over older assistant-generated lists. Do not carry one-time tasks into a new date unless the user explicitly deferred them.
            If the context does not contain enough information, ask a short useful follow-up instead of pretending.

            # Tool Use

            Use available tools when the stored prompt requires current information or safe external action, such as web search, weather, local time, or Google Calendar read/create.
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
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: posted task message recording failed',
      );
    }
  }

  static async #finishSuccessfulTaskRun({
    task,
    runId,
    claimToken,
    output,
    ranAt,
  }: {
    task: AgentScheduledTask;
    runId: string;
    claimToken: string;
    output: string;
    ranAt: Date;
  }) {
    const nextRunAt = this.#getNextRunAtAfterRun({ task, ranAt });
    const result = await AgentScheduleDbService.finishSuccessfulTaskRun({
      task,
      runId,
      claimToken,
      output,
      ranAt,
      nextRunAt,
    });

    return result.taskUpdated;
  }

  static async #advanceTaskAfterSuccess({
    task,
    ranAt,
  }: {
    task: AgentScheduledTask;
    ranAt: Date;
  }) {
    const nextRunAt = this.#getNextRunAtAfterRun({ task, ranAt });

    return AgentScheduleDbService.advanceTaskAfterRun({
      task,
      outcome: 'success',
      ranAt,
      nextRunAt,
    });
  }

  static async #advanceTaskAfterFailure({
    task,
    ranAt,
  }: {
    task: AgentScheduledTask;
    ranAt: Date;
  }) {
    const nextRunAt = this.#getNextRunAtAfterRun({ task, ranAt });

    return AgentScheduleDbService.advanceTaskAfterRun({
      task,
      outcome: 'failure',
      ranAt,
      nextRunAt,
    });
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
    claimToken,
    error,
  }: {
    task: AgentScheduledTask;
    runId: string;
    claimToken: string;
    error: unknown;
  }) {
    try {
      await AgentScheduleDbService.markTaskRunFailed({
        runId,
        claimToken,
        error,
      });
    } catch (error) {
      logger.error(
        {
          taskId: task.id,
          runId,
          identityId: task.identityId,
          threadId: task.threadId,
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

  static #getNextRunAtAfterRun({ task, ranAt }: { task: AgentScheduledTask; ranAt: Date }) {
    return task.scheduleKind === 'recurring'
      ? (AgentScheduleService.getNextRunAtForTask({ task, now: ranAt }) ?? undefined)
      : undefined;
  }

  static async #prepareTaskDelivery({
    bot,
    task,
    runId,
    claimToken,
    scheduledFor,
  }: Pick<ExecuteScheduleTaskInput, 'bot'> & {
    task: AgentScheduledTask;
    runId: string;
    claimToken: string;
    scheduledFor: Date;
  }): Promise<
    | { status: 'ready'; task: AgentScheduledTask; output: string }
    | { status: 'skipped'; currentTask: AgentScheduledTask | null }
  > {
    let deliveryTask = task;

    for (let attempt = 1; attempt <= MAX_TASK_GENERATION_ATTEMPTS; attempt += 1) {
      const output = await this.#generateTaskMessage({ bot, task: deliveryTask });
      const currentTask = await AgentScheduleDbService.getTaskById({ taskId: task.id });

      if (!currentTask || !this.#isCurrentOccurrence({ task, currentTask, scheduledFor })) {
        return { status: 'skipped', currentTask };
      }

      if (currentTask.revision !== deliveryTask.revision) {
        logger.info(
          {
            taskId: task.id,
            runId,
            previousRevision: deliveryTask.revision,
            currentRevision: currentTask.revision,
            attempt,
          },
          '[AGENT_SCHEDULE]: task changed during generation; regenerating',
        );
        deliveryTask = currentTask;
        continue;
      }

      const leaseRenewed = await AgentScheduleDbService.renewTaskRunLease({
        runId,
        taskId: task.id,
        claimToken,
        taskRevision: currentTask.revision,
        scheduledFor,
      });

      if (leaseRenewed) {
        return { status: 'ready', task: currentTask, output };
      }

      const latestTask = await AgentScheduleDbService.getTaskById({ taskId: task.id });

      if (
        !latestTask ||
        !this.#isCurrentOccurrence({ task, currentTask: latestTask, scheduledFor })
      ) {
        return { status: 'skipped', currentTask: latestTask };
      }

      if (latestTask.revision !== currentTask.revision) {
        deliveryTask = latestTask;
        continue;
      }

      throw this.#retryableScheduleExecutionError({
        message: 'Scheduled task run claim was lost before delivery.',
        taskId: task.id,
        runId,
        retryReason: 'claim_lost',
      });
    }

    throw this.#retryableScheduleExecutionError({
      message: 'Scheduled task kept changing while its message was generated.',
      taskId: task.id,
      runId,
      retryReason: 'task_revision_churn',
    });
  }

  static async #reconcileDeliveredOccurrence({
    task,
    scheduledFor,
    ranAt,
  }: {
    task: AgentScheduledTask;
    scheduledFor: Date;
    ranAt: Date;
  }) {
    for (let attempt = 1; attempt <= MAX_TASK_RECONCILIATION_ATTEMPTS; attempt += 1) {
      const currentTask = await AgentScheduleDbService.getTaskById({ taskId: task.id });

      if (!currentTask || !this.#isCurrentOccurrence({ task, currentTask, scheduledFor })) {
        return false;
      }

      const result = await this.#advanceTaskAfterSuccess({ task: currentTask, ranAt });

      if (result.taskUpdated) {
        return true;
      }

      logger.info(
        { taskId: task.id, currentRevision: currentTask.revision, attempt },
        '[AGENT_SCHEDULE]: delivered task changed during reconciliation; retrying',
      );
    }

    throw this.#retryableScheduleExecutionError({
      message: 'Delivered scheduled task kept changing during state reconciliation.',
      taskId: task.id,
      retryReason: 'task_reconciliation_churn',
      delivered: true,
    });
  }

  static #isCurrentOccurrence({
    task,
    currentTask,
    scheduledFor,
  }: {
    task: AgentScheduledTask;
    currentTask: AgentScheduledTask;
    scheduledFor: Date;
  }) {
    return (
      currentTask.status === 'active' &&
      currentTask.scheduleKind === task.scheduleKind &&
      this.#getTaskTriggerVersion(currentTask) === this.#getTaskTriggerVersion(task) &&
      this.#isSameInstant(currentTask.nextRunAt, scheduledFor)
    );
  }

  static #retryableScheduleExecutionError({
    message,
    taskId,
    runId,
    retryReason,
    delivered = false,
  }: {
    message: string;
    taskId: string;
    runId?: string;
    retryReason: 'claim_lost' | 'task_reconciliation_churn' | 'task_revision_churn';
    delivered?: boolean;
  }) {
    return new AppError({
      code: AppErrorCode.SCHEDULE_TASK_EXECUTION_FAILED,
      message,
      context: {
        taskId,
        runId,
        retryReason,
        retryWithoutAdvancing: true,
        delivered,
      },
      retryable: true,
    });
  }

  static #isLostRunClaim(error: unknown) {
    return (
      AppError.is(error) &&
      (error.code === AppErrorCode.SCHEDULE_TASK_RUN_NOT_FOUND ||
        error.context.retryReason === 'claim_lost')
    );
  }

  static #requiresRetryWithoutAdvancing(error: unknown) {
    return (
      AppError.is(error) &&
      (error.code === AppErrorCode.SCHEDULE_TASK_RUN_NOT_FOUND ||
        error.context.retryWithoutAdvancing === true)
    );
  }
}

import type { AgentScheduledTask, NewAgentScheduledTask } from '@/types';

import { and, asc, count, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { agentScheduledTaskRuns, agentScheduledTasks } from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

const SCHEDULE_TASK_RUNNING_LEASE_MS = 1000 * 60 * 5;

export class AgentScheduleDbService extends DbService {
  static async createTask(input: CreateScheduledTaskInput) {
    const [task] = await this.client.insert(agentScheduledTasks).values(input).returning();

    return task ?? null;
  }

  static async listTasks({
    identityId,
    threadId,
    includeInactive = false,
    limit = 50,
  }: ListScheduledTasksInput) {
    return this.client
      .select()
      .from(agentScheduledTasks)
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.threadId, threadId),
          includeInactive ? undefined : inArray(agentScheduledTasks.status, ['active', 'paused']),
        ),
      )
      .orderBy(asc(agentScheduledTasks.nextRunAt))
      .limit(limit);
  }

  static async countActiveTasksByKind({
    identityId,
    scheduleKind,
  }: CountActiveScheduledTasksInput) {
    const [result] = await this.client
      .select({ count: count() })
      .from(agentScheduledTasks)
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.scheduleKind, scheduleKind),
          eq(agentScheduledTasks.status, 'active'),
        ),
      );

    return result?.count ?? 0;
  }

  static async getTaskForUser({ identityId, threadId, taskId }: GetScheduledTaskForUserInput) {
    const [task] = await this.client
      .select()
      .from(agentScheduledTasks)
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.threadId, threadId),
          eq(agentScheduledTasks.id, taskId),
        ),
      )
      .limit(1);

    return task ?? null;
  }

  static async updateTask({
    identityId,
    threadId,
    taskId,
    metadata,
    ...updates
  }: UpdateScheduledTaskInput) {
    const [task] = await this.client
      .update(agentScheduledTasks)
      .set({
        ...this.#withoutUndefined(updates),
        metadata: metadata
          ? sql`${agentScheduledTasks.metadata} || ${metadata}`
          : agentScheduledTasks.metadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.threadId, threadId),
          eq(agentScheduledTasks.id, taskId),
          inArray(agentScheduledTasks.status, ['active', 'paused']),
        ),
      )
      .returning();

    if (!task) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Active or paused scheduled task was not found.',
        context: { identityId, threadId, taskId },
        retryable: false,
      });
    }

    return task;
  }

  static async pauseTask({ identityId, threadId, taskId, metadata }: PauseScheduledTaskInput) {
    const [task] = await this.client
      .update(agentScheduledTasks)
      .set({
        status: 'paused',
        metadata: metadata
          ? sql`${agentScheduledTasks.metadata} || ${metadata}`
          : agentScheduledTasks.metadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.threadId, threadId),
          eq(agentScheduledTasks.id, taskId),
          eq(agentScheduledTasks.status, 'active'),
        ),
      )
      .returning();

    if (!task) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Active scheduled task was not found.',
        context: { identityId, threadId, taskId },
        retryable: false,
      });
    }

    return task;
  }

  static async resumeTask({
    identityId,
    threadId,
    taskId,
    nextRunAt,
    qstashMessageId,
    qstashScheduleId,
    metadata,
  }: ResumeScheduledTaskInput) {
    const [task] = await this.client
      .update(agentScheduledTasks)
      .set({
        status: 'active',
        nextRunAt,
        qstashMessageId,
        qstashScheduleId,
        metadata: metadata
          ? sql`${agentScheduledTasks.metadata} || ${metadata}`
          : agentScheduledTasks.metadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.threadId, threadId),
          eq(agentScheduledTasks.id, taskId),
          eq(agentScheduledTasks.status, 'paused'),
        ),
      )
      .returning();

    if (!task) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Paused scheduled task was not found.',
        context: { identityId, threadId, taskId },
        retryable: false,
      });
    }

    return task;
  }

  static async cancelTask({ identityId, threadId, taskId, metadata }: CancelScheduledTaskInput) {
    const [task] = await this.client
      .update(agentScheduledTasks)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        metadata: metadata
          ? sql`${agentScheduledTasks.metadata} || ${metadata}`
          : agentScheduledTasks.metadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentScheduledTasks.identityId, identityId),
          eq(agentScheduledTasks.threadId, threadId),
          eq(agentScheduledTasks.id, taskId),
          inArray(agentScheduledTasks.status, ['active', 'paused']),
        ),
      )
      .returning();

    if (!task) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Active or paused scheduled task was not found.',
        context: { identityId, threadId, taskId },
        retryable: false,
      });
    }

    return task;
  }

  static async getActiveTaskById({ taskId }: GetScheduledTaskInput) {
    const [task] = await this.client
      .select()
      .from(agentScheduledTasks)
      .where(and(eq(agentScheduledTasks.id, taskId), eq(agentScheduledTasks.status, 'active')))
      .limit(1);

    return task ?? null;
  }

  static async getTaskById({ taskId }: GetScheduledTaskInput) {
    const [task] = await this.client
      .select()
      .from(agentScheduledTasks)
      .where(eq(agentScheduledTasks.id, taskId))
      .limit(1);

    return task ?? null;
  }

  static async createTaskRun({ taskId, scheduledFor }: CreateScheduledTaskRunInput) {
    const now = new Date();
    const staleStartedBefore = new Date(now.getTime() - SCHEDULE_TASK_RUNNING_LEASE_MS);

    const [run] = await this.client
      .insert(agentScheduledTaskRuns)
      .values({
        taskId,
        scheduledFor,
        status: 'running',
      })
      .onConflictDoUpdate({
        target: [agentScheduledTaskRuns.taskId, agentScheduledTaskRuns.scheduledFor],
        set: {
          status: 'running',
          output: null,
          error: null,
          startedAt: now,
          finishedAt: null,
        },
        where: or(
          eq(agentScheduledTaskRuns.status, 'failed'),
          and(
            eq(agentScheduledTaskRuns.status, 'running'),
            lt(agentScheduledTaskRuns.startedAt, staleStartedBefore),
          ),
        ),
      })
      .returning();

    return run ?? null;
  }

  static async satisfyTaskOccurrence({
    identityId,
    threadId,
    taskId,
    sourceMessageId,
    satisfiedAt,
  }: SatisfyScheduledTaskOccurrenceInput) {
    return this.client.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(agentScheduledTasks)
        .where(
          and(
            eq(agentScheduledTasks.identityId, identityId),
            eq(agentScheduledTasks.threadId, threadId),
            eq(agentScheduledTasks.id, taskId),
          ),
        )
        .for('update')
        .limit(1);

      if (!task) {
        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
          message: 'Scheduled task was not found for occurrence completion.',
          context: { identityId, threadId, taskId },
          retryable: false,
          userMessage: 'I could not find that reminder.',
        });
      }

      const [run] = await tx
        .insert(agentScheduledTaskRuns)
        .values({
          taskId,
          scheduledFor: task.nextRunAt,
          status: 'satisfied',
          sourceMessageId,
          startedAt: satisfiedAt,
          finishedAt: satisfiedAt,
        })
        .onConflictDoUpdate({
          target: [agentScheduledTaskRuns.taskId, agentScheduledTaskRuns.scheduledFor],
          set: {
            status: 'satisfied',
            sourceMessageId,
            error: null,
            startedAt: satisfiedAt,
            finishedAt: satisfiedAt,
          },
          where: eq(agentScheduledTaskRuns.status, 'failed'),
        })
        .returning();

      if (!run) {
        const [existingRun] = await tx
          .select()
          .from(agentScheduledTaskRuns)
          .where(
            and(
              eq(agentScheduledTaskRuns.taskId, taskId),
              eq(agentScheduledTaskRuns.scheduledFor, task.nextRunAt),
            ),
          )
          .limit(1);

        if (existingRun?.status === 'satisfied') {
          return { task, alreadySatisfied: true };
        }

        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_OCCURRENCE_NOT_PENDING,
          message: 'Scheduled task occurrence is already running or delivered.',
          context: {
            identityId,
            threadId,
            taskId,
            scheduledFor: task.nextRunAt.toISOString(),
            runStatus: existingRun?.status,
          },
          retryable: false,
          userMessage: 'That reminder is already being handled or was already sent.',
        });
      }

      if (task.status !== 'active') {
        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_OCCURRENCE_NOT_PENDING,
          message: 'Scheduled task is not active.',
          context: { identityId, threadId, taskId, status: task.status },
          retryable: false,
          userMessage: 'That reminder is not currently active.',
        });
      }

      if (task.scheduleKind === 'recurring') {
        return { task, alreadySatisfied: false };
      }

      const [completedTask] = await tx
        .update(agentScheduledTasks)
        .set({
          status: 'completed',
          lastRunAt: satisfiedAt,
          completedAt: satisfiedAt,
          updatedAt: satisfiedAt,
        })
        .where(and(eq(agentScheduledTasks.id, taskId), eq(agentScheduledTasks.status, 'active')))
        .returning();

      if (!completedTask) {
        throw new AppError({
          code: AppErrorCode.SCHEDULE_TASK_OCCURRENCE_NOT_PENDING,
          message: 'One-time scheduled task could not be completed.',
          context: { identityId, threadId, taskId },
          retryable: false,
          userMessage: 'That reminder is no longer pending.',
        });
      }

      return { task: completedTask, alreadySatisfied: false };
    });
  }

  static async getTaskRunByScheduledFor({
    taskId,
    scheduledFor,
  }: GetScheduledTaskRunByScheduledForInput) {
    const [run] = await this.client
      .select()
      .from(agentScheduledTaskRuns)
      .where(
        and(
          eq(agentScheduledTaskRuns.taskId, taskId),
          eq(agentScheduledTaskRuns.scheduledFor, scheduledFor),
        ),
      )
      .limit(1);

    return run ?? null;
  }

  static async markTaskRunSent({ runId, output }: MarkScheduledTaskRunSentInput) {
    const [run] = await this.client
      .update(agentScheduledTaskRuns)
      .set({
        status: 'sent',
        output,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(agentScheduledTaskRuns.id, runId))
      .returning();

    if (!run) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_RUN_NOT_FOUND,
        message: 'Scheduled task run was not found for sent update.',
        context: { runId },
        retryable: false,
      });
    }

    return run;
  }

  static async markTaskRunFailed({ runId, error }: MarkScheduledTaskRunFailedInput) {
    const [run] = await this.client
      .update(agentScheduledTaskRuns)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(agentScheduledTaskRuns.id, runId))
      .returning();

    if (!run) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_RUN_NOT_FOUND,
        message: 'Scheduled task run was not found for failure update.',
        context: { runId },
        retryable: false,
      });
    }

    return run;
  }

  static async completeTask({ taskId, ranAt }: CompleteScheduledTaskInput) {
    return this.#updateTaskAfterRun({
      taskId,
      status: 'completed',
      ranAt,
      completedAt: ranAt,
    });
  }

  static async failTask({ taskId, ranAt }: FailScheduledTaskInput) {
    return this.#updateTaskAfterRun({
      taskId,
      status: 'failed',
      ranAt,
      failedAt: ranAt,
    });
  }

  static async rescheduleTask({ taskId, ranAt, nextRunAt }: RescheduleScheduledTaskInput) {
    return this.#updateTaskAfterRun({
      taskId,
      status: 'active',
      ranAt,
      nextRunAt,
    });
  }

  static #withoutUndefined<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
      Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
    ) as Partial<T>;
  }

  static async #updateTaskAfterRun({
    taskId,
    status,
    ranAt,
    nextRunAt,
    completedAt,
    failedAt,
  }: {
    taskId: string;
    status: AgentScheduledTask['status'];
    ranAt: Date;
    nextRunAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
  }) {
    const [task] = await this.client
      .update(agentScheduledTasks)
      .set({
        status,
        nextRunAt,
        lastRunAt: ranAt,
        completedAt,
        failedAt,
        updatedAt: new Date(),
      })
      .where(eq(agentScheduledTasks.id, taskId))
      .returning();

    if (!task) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_NOT_FOUND,
        message: 'Scheduled task was not found for run update.',
        context: { taskId, status },
        retryable: false,
      });
    }

    return task;
  }
}

type CreateScheduledTaskInput = NewAgentScheduledTask;

type ListScheduledTasksInput = {
  identityId: string;
  threadId: string;
  includeInactive?: boolean;
  limit?: number;
};

type CountActiveScheduledTasksInput = {
  identityId: string;
  scheduleKind: AgentScheduledTask['scheduleKind'];
};

type CancelScheduledTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  metadata?: Record<string, unknown>;
};

type GetScheduledTaskForUserInput = {
  identityId: string;
  threadId: string;
  taskId: string;
};

type UpdateScheduledTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  title?: string;
  prompt?: string;
  scheduleKind?: AgentScheduledTask['scheduleKind'];
  timeZone?: string;
  nextRunAt?: Date;
  recurrence?: Record<string, unknown>;
  qstashMessageId?: string | null;
  qstashScheduleId?: string | null;
  metadata?: Record<string, unknown>;
};

type PauseScheduledTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  metadata?: Record<string, unknown>;
};

type ResumeScheduledTaskInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  nextRunAt: Date;
  qstashMessageId?: string | null;
  qstashScheduleId?: string | null;
  metadata?: Record<string, unknown>;
};

type GetScheduledTaskInput = {
  taskId: string;
};

type CreateScheduledTaskRunInput = {
  taskId: string;
  scheduledFor: Date;
};

type GetScheduledTaskRunByScheduledForInput = {
  taskId: string;
  scheduledFor: Date;
};

type SatisfyScheduledTaskOccurrenceInput = {
  identityId: string;
  threadId: string;
  taskId: string;
  sourceMessageId?: string;
  satisfiedAt: Date;
};

type MarkScheduledTaskRunSentInput = {
  runId: string;
  output: string;
};

type MarkScheduledTaskRunFailedInput = {
  runId: string;
  error: unknown;
};

type CompleteScheduledTaskInput = {
  taskId: string;
  ranAt: Date;
};

type FailScheduledTaskInput = {
  taskId: string;
  ranAt: Date;
};

type RescheduleScheduledTaskInput = {
  taskId: string;
  ranAt: Date;
  nextRunAt: Date;
};

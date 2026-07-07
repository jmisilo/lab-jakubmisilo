import type { AgentScheduledTask, NewAgentScheduledTask } from '@/types';

import { and, asc, count, eq, sql } from 'drizzle-orm';

import { agentScheduledTaskRuns, agentScheduledTasks } from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

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
          includeInactive ? undefined : eq(agentScheduledTasks.status, 'active'),
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
          startedAt: new Date(),
          finishedAt: null,
        },
        where: eq(agentScheduledTaskRuns.status, 'failed'),
      })
      .returning();

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

type GetScheduledTaskInput = {
  taskId: string;
};

type CreateScheduledTaskRunInput = {
  taskId: string;
  scheduledFor: Date;
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

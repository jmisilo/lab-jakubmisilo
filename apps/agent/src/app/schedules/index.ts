import type { Mastra } from '@mastra/core/mastra';
import type { AgentSchedule } from '@mastra/core/schedules';
import type { MastraUnion } from '@mastra/core/tools';

import { Client, Receiver } from '@upstash/qstash';
import { and, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { ScheduleExecutionPayload, ScheduleFailureCallbackPayload } from './schemas';
import { database } from '../../infrastructure/database';
import {
  oneTimeSchedules,
  recurringScheduleRuns,
  scheduleOccurrenceCompletions,
} from '../../infrastructure/database/schema';
import { logger } from '../../infrastructure/logger';
import { recurringOccurrenceForCompletion, recurringOccurrenceForTrigger } from './occurrences';
import { ScheduleExecutionPayloadSchema } from './schemas';

const ACTIVE_ONE_TIME_LIMIT = 10;
const ACTIVE_RECURRING_LIMIT = 10;
const MAX_ONE_TIME_DELAY_MS = 7 * 24 * 60 * 60 * 1_000;
const EARLY_DELIVERY_TOLERANCE_MS = 60_000;
const RUN_LEASE_MS = 5 * 60 * 1_000;
const QSTASH_SIGNATURE_CLOCK_TOLERANCE_SECONDS = 30;
const QSTASH_EXECUTION_TIMEOUT_SECONDS = 300;

export type ScheduleDelivery = {
  runScheduled(input: {
    resourceId: string;
    threadId: string;
    prompt: string;
    timeZone?: string;
    source: 'one-time-schedule' | 'recurring-schedule';
    deliveryId?: string;
  }): Promise<string>;
  postToThread(threadId: string, text: string): Promise<void>;
};

let scheduleDelivery: ScheduleDelivery | undefined;

/** Configure the transport boundary from Mastra composition. */
export function configureScheduleDelivery(delivery: ScheduleDelivery) {
  scheduleDelivery = delivery;
}

export class SchedulingService {
  static async createOneTime(input: CreateOneTimeScheduleInput) {
    if (input.idempotencyKey) {
      const [existing] = await database
        .select()
        .from(oneTimeSchedules)
        .where(
          and(
            eq(oneTimeSchedules.resourceId, input.resourceId),
            eq(oneTimeSchedules.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return this.#reuseIdempotentOneTime(existing);
      }
    }

    const runAt = new Date(input.runAt);
    const delay = runAt.getTime() - Date.now();

    if (delay <= 0 || delay > MAX_ONE_TIME_DELAY_MS) {
      throw new Error('One-time reminders must be in the future and no more than seven days away.');
    }

    const [{ value }] = await database
      .select({ value: count() })
      .from(oneTimeSchedules)
      .where(
        and(
          eq(oneTimeSchedules.resourceId, input.resourceId),
          inArray(oneTimeSchedules.status, ['active', 'running']),
        ),
      );

    if ((value ?? 0) >= ACTIVE_ONE_TIME_LIMIT) {
      throw new Error('You already have 10 active one-time reminders.');
    }

    const inserted = input.idempotencyKey
      ? await database
          .insert(oneTimeSchedules)
          .values({ ...input, runAt })
          .onConflictDoNothing()
          .returning()
      : await database
          .insert(oneTimeSchedules)
          .values({ ...input, runAt })
          .returning();

    const [schedule] = inserted;

    if (!schedule) {
      if (input.idempotencyKey) {
        const [existing] = await database
          .select()
          .from(oneTimeSchedules)
          .where(
            and(
              eq(oneTimeSchedules.resourceId, input.resourceId),
              eq(oneTimeSchedules.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);

        if (existing) {
          return this.#reuseIdempotentOneTime(existing);
        }
      }

      throw new Error('The reminder could not be saved.');
    }

    return this.#registerOneTimeSchedule(schedule);
  }

  static async #reuseIdempotentOneTime(schedule: OneTimeSchedule) {
    if (schedule.status === 'failed' && !schedule.qstashMessageId) {
      const [retry] = await database
        .update(oneTimeSchedules)
        .set({
          status: 'active',
          revision: sql`${oneTimeSchedules.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(oneTimeSchedules.id, schedule.id),
            eq(oneTimeSchedules.resourceId, schedule.resourceId),
            eq(oneTimeSchedules.status, 'failed'),
            isNull(oneTimeSchedules.qstashMessageId),
            eq(oneTimeSchedules.revision, schedule.revision),
          ),
        )
        .returning();

      if (retry) {
        return this.#registerOneTimeSchedule(retry);
      }

      const [current] = await database
        .select()
        .from(oneTimeSchedules)
        .where(eq(oneTimeSchedules.id, schedule.id))
        .limit(1);

      if (current?.status === 'active' && !current.qstashMessageId) {
        return this.#registerOneTimeSchedule(current);
      }

      return current ?? schedule;
    }

    if (schedule.status === 'active' && !schedule.qstashMessageId) {
      return this.#registerOneTimeSchedule(schedule);
    }

    return schedule;
  }

  static async #registerOneTimeSchedule(schedule: OneTimeSchedule) {
    let messageId: string | undefined;

    try {
      messageId = await this.#publishOneTime({
        scheduleId: schedule.id,
        revision: schedule.revision,
        runAt: schedule.runAt,
        title: schedule.title,
      });

      const [persisted] = await database
        .update(oneTimeSchedules)
        .set({ qstashMessageId: messageId, updatedAt: new Date() })
        .where(
          and(
            eq(oneTimeSchedules.id, schedule.id),
            eq(oneTimeSchedules.revision, schedule.revision),
            eq(oneTimeSchedules.status, 'active'),
          ),
        )
        .returning({ id: oneTimeSchedules.id });

      if (!persisted) {
        throw new Error('The reminder changed before its delivery could be registered.');
      }

      return { ...schedule, qstashMessageId: messageId };
    } catch (error) {
      // A successful QStash publish followed by a database failure must not leave
      // an orphaned reminder that can still fire after the row is marked failed.
      if (messageId) {
        try {
          await this.#qstash.messages.cancel(messageId);
        } catch (compensationError) {
          error = new AggregateError(
            [error, compensationError],
            'The one-time reminder could not be saved and its QStash message could not be cancelled.',
          );
        }
      }

      try {
        await database
          .update(oneTimeSchedules)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(
            and(
              eq(oneTimeSchedules.id, schedule.id),
              eq(oneTimeSchedules.revision, schedule.revision),
              eq(oneTimeSchedules.status, 'active'),
            ),
          );
      } catch (stateError) {
        error = new AggregateError(
          [error, stateError],
          'The one-time reminder could not be saved and its state could not be updated.',
        );
      }
      throw error;
    }
  }

  static async createRecurring(input: CreateRecurringScheduleInput) {
    this.#assertSupportedCron(input.cron);

    const id = input.idempotencyKey ? `agent_${input.idempotencyKey}` : undefined;

    if (id) {
      const existing = await input.schedules.get(id);

      if (
        existing &&
        'agentId' in existing &&
        existing.agentId === 'agent' &&
        existing.resourceId === input.resourceId
      ) {
        return this.#repairRecurringTrigger(input.schedules, existing);
      }
    }

    const existing = await input.schedules.list({
      agentId: 'agent',
      resourceId: input.resourceId,
      status: 'active',
    });

    if (existing.length >= ACTIVE_RECURRING_LIMIT) {
      throw new Error('You already have 10 active recurring schedules.');
    }

    let schedule: AgentSchedule;
    const triggerVersion = crypto.randomUUID();

    try {
      schedule = await input.schedules.create({
        ...(id ? { id } : {}),
        agentId: 'agent',
        name: input.title,
        prompt: input.prompt,
        cron: input.cron,
        timezone: input.timeZone,
        threadId: input.threadId,
        resourceId: input.resourceId,
        ifIdle: { behavior: 'wake' },
        ifActive: { behavior: 'deliver' },
        metadata: {
          kind: 'recurring',
          triggerProvider: 'qstash',
          triggerVersion,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
      });
    } catch (error) {
      if (id) {
        const existing = await input.schedules.get(id);

        if (
          existing &&
          'agentId' in existing &&
          existing.agentId === 'agent' &&
          existing.resourceId === input.resourceId
        ) {
          return this.#repairRecurringTrigger(input.schedules, existing);
        }
      }

      throw error;
    }

    try {
      await this.#upsertRecurringTrigger({
        scheduleId: schedule.id,
        title: input.title,
        cron: input.cron,
        timeZone: input.timeZone,
        triggerVersion,
      });

      return schedule;
    } catch (error) {
      await input.schedules.delete(schedule.id);
      throw error;
    }
  }

  static async updateRecurring(input: UpdateRecurringScheduleInput) {
    const schedule = await input.schedules.get(input.scheduleId);

    if (!schedule || !('resourceId' in schedule) || schedule.resourceId !== input.resourceId) {
      return false;
    }

    if (input.cron) {
      this.#assertSupportedCron(input.cron);
    }

    const title = input.title ?? schedule.name ?? 'Recurring task';
    const cron = input.cron ?? schedule.cron;
    const timeZone = input.timeZone ?? schedule.timezone ?? 'UTC';
    const triggerVersion = crypto.randomUUID();

    await this.#upsertRecurringTrigger({
      scheduleId: schedule.id,
      title,
      cron,
      timeZone,
      triggerVersion,
    });

    if (schedule.status === 'paused') {
      await this.#qstash.schedules.pause({
        schedule: this.#recurringTriggerId(schedule.id),
      });
    }

    try {
      await input.schedules.update(input.scheduleId, {
        name: input.title,
        prompt: input.prompt,
        cron: input.cron,
        timezone: input.timeZone,
        metadata: {
          ...schedule.metadata,
          triggerVersion,
        },
      });
    } catch (error) {
      try {
        await this.#upsertRecurringTrigger({
          scheduleId: schedule.id,
          title: schedule.name ?? 'Recurring task',
          cron: schedule.cron,
          timeZone: schedule.timezone ?? 'UTC',
          triggerVersion: this.#recurringTriggerVersion(schedule),
        });

        if (schedule.status === 'paused') {
          await this.#qstash.schedules.pause({
            schedule: this.#recurringTriggerId(schedule.id),
          });
        }
      } catch {
        // The original persistence error is more useful than provider rollback failure.
      }

      throw error;
    }

    return true;
  }

  static async changeRecurring(input: ChangeRecurringScheduleInput) {
    const schedule = await input.schedules.get(input.scheduleId);

    if (!schedule || !('resourceId' in schedule) || schedule.resourceId !== input.resourceId) {
      return false;
    }

    if (input.action === 'pause') {
      await this.#qstash.schedules.pause({
        schedule: this.#recurringTriggerId(schedule.id),
      });

      try {
        await input.schedules.pause(input.scheduleId);
      } catch (error) {
        await this.#qstash.schedules.resume({
          schedule: this.#recurringTriggerId(schedule.id),
        });
        throw error;
      }
    } else if (input.action === 'resume') {
      await this.#qstash.schedules.resume({
        schedule: this.#recurringTriggerId(schedule.id),
      });

      try {
        await input.schedules.resume(input.scheduleId);
      } catch (error) {
        await this.#qstash.schedules.pause({
          schedule: this.#recurringTriggerId(schedule.id),
        });
        throw error;
      }
    } else {
      await this.#qstash.schedules.delete(this.#recurringTriggerId(schedule.id));

      try {
        await input.schedules.delete(input.scheduleId);
      } catch (error) {
        try {
          await this.#repairRecurringTrigger(input.schedules, schedule);
        } catch (compensationError) {
          throw new AggregateError(
            [error, compensationError],
            'The recurring schedule could not be cancelled or restored.',
          );
        }

        throw error;
      }
    }

    return true;
  }

  static async runRecurringNow({
    mastra,
    resourceId,
    scheduleId,
  }: {
    mastra: MastraUnion;
    resourceId: string;
    scheduleId: string;
  }) {
    const schedule = await mastra.schedules.get(scheduleId);

    if (
      !schedule ||
      !('resourceId' in schedule) ||
      schedule.resourceId !== resourceId ||
      !('agentId' in schedule) ||
      schedule.agentId !== 'agent' ||
      schedule.status !== 'active'
    ) {
      return false;
    }

    const result = await this.executeRecurring({
      mastra,
      scheduleId,
      triggerVersion: this.#recurringTriggerVersion(schedule),
      deliveryId: `manual-${crypto.randomUUID()}`,
      respectOccurrenceCompletion: false,
    });

    return result.status === 'completed';
  }

  static async completeOccurrence({
    schedules,
    resourceId,
    scheduleId,
  }: OwnedScheduleInput & { schedules: Mastra['schedules'] }) {
    const [oneTime] = isUuid(scheduleId)
      ? await database
          .update(oneTimeSchedules)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(
            and(
              eq(oneTimeSchedules.id, scheduleId),
              eq(oneTimeSchedules.resourceId, resourceId),
              inArray(oneTimeSchedules.status, ['active', 'paused']),
            ),
          )
          .returning()
      : [];

    if (oneTime) {
      await this.#cancelOneTimeMessageBestEffort({
        messageId: oneTime.qstashMessageId,
        scheduleId: oneTime.id,
      });

      return { kind: 'one_time' as const };
    }

    const recurring = await schedules.get(scheduleId);

    if (
      !recurring ||
      !('resourceId' in recurring) ||
      recurring.resourceId !== resourceId ||
      !('cron' in recurring) ||
      !recurring.cron ||
      recurring.status !== 'active'
    ) {
      return null;
    }

    const timeZone =
      'timezone' in recurring && typeof recurring.timezone === 'string'
        ? recurring.timezone
        : 'UTC';
    const now = new Date();
    const scheduledFor = recurringOccurrenceForCompletion({
      cron: recurring.cron,
      timeZone,
      now,
    });

    if (!scheduledFor) {
      return null;
    }

    if (this.#localDate(scheduledFor, timeZone) !== this.#localDate(now, timeZone)) {
      throw new Error('That recurring task has no pending occurrence today.');
    }

    await database
      .insert(scheduleOccurrenceCompletions)
      .values({ scheduleId: recurring.id, resourceId, scheduledFor })
      .onConflictDoNothing();

    return { kind: 'recurring' as const, scheduledFor: scheduledFor.toISOString() };
  }

  static async prepareOccurrence({
    scheduleId,
    cron,
    firedAt,
    timeZone,
  }: {
    scheduleId: string;
    cron: string;
    firedAt: Date;
    timeZone: string;
  }) {
    const scheduledFor = recurringOccurrenceForTrigger({ cron, firedAt, timeZone });

    if (!scheduledFor) {
      return undefined;
    }

    const [completion] = await database
      .select({ scheduleId: scheduleOccurrenceCompletions.scheduleId })
      .from(scheduleOccurrenceCompletions)
      .where(
        and(
          eq(scheduleOccurrenceCompletions.scheduleId, scheduleId),
          eq(scheduleOccurrenceCompletions.scheduledFor, scheduledFor),
        ),
      )
      .limit(1);

    return completion ? null : undefined;
  }

  static async list({
    schedules,
    resourceId,
    includeInactive,
  }: {
    schedules: Mastra['schedules'];
    resourceId: string;
    includeInactive: boolean;
  }) {
    const [recurring, oneTime] = await Promise.all([
      schedules.list({
        agentId: 'agent',
        resourceId,
        ...(includeInactive ? {} : { status: 'active' as const }),
      }),
      database
        .select()
        .from(oneTimeSchedules)
        .where(
          and(
            eq(oneTimeSchedules.resourceId, resourceId),
            includeInactive ? undefined : inArray(oneTimeSchedules.status, ['active', 'running']),
          ),
        ),
    ]);

    return {
      recurring: await Promise.all(
        recurring.map((schedule) => this.#withRecurringTriggerState(schedule)),
      ),
      oneTime,
    };
  }

  static async get({
    schedules,
    resourceId,
    scheduleId,
  }: {
    schedules: Mastra['schedules'];
    resourceId: string;
    scheduleId: string;
  }) {
    const [oneTime] = isUuid(scheduleId)
      ? await database
          .select()
          .from(oneTimeSchedules)
          .where(
            and(eq(oneTimeSchedules.id, scheduleId), eq(oneTimeSchedules.resourceId, resourceId)),
          )
          .limit(1)
      : [];

    if (oneTime) {
      return { kind: 'one_time' as const, schedule: oneTime };
    }

    const recurring = await schedules.get(scheduleId);

    if (!recurring || !('resourceId' in recurring) || recurring.resourceId !== resourceId) {
      return null;
    }

    return {
      kind: 'recurring' as const,
      schedule: await this.#withRecurringTriggerState(recurring),
    };
  }

  static async cancelOneTime({
    resourceId,
    scheduleId,
  }: {
    resourceId: string;
    scheduleId: string;
  }) {
    if (!isUuid(scheduleId)) {
      return false;
    }

    const [schedule] = await database
      .update(oneTimeSchedules)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(oneTimeSchedules.id, scheduleId),
          eq(oneTimeSchedules.resourceId, resourceId),
          inArray(oneTimeSchedules.status, ['active', 'paused']),
        ),
      )
      .returning();

    if (!schedule) {
      return false;
    }

    await this.#cancelOneTimeMessageBestEffort({
      messageId: schedule.qstashMessageId,
      scheduleId: schedule.id,
    });

    return true;
  }

  static async pauseOneTime({ resourceId, scheduleId }: OwnedScheduleInput) {
    if (!isUuid(scheduleId)) {
      return false;
    }

    const [schedule] = await database
      .update(oneTimeSchedules)
      .set({
        status: 'paused',
        revision: sql`${oneTimeSchedules.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(oneTimeSchedules.id, scheduleId),
          eq(oneTimeSchedules.resourceId, resourceId),
          eq(oneTimeSchedules.status, 'active'),
        ),
      )
      .returning();

    if (!schedule) {
      return false;
    }

    await this.#cancelOneTimeMessageBestEffort({
      messageId: schedule.qstashMessageId,
      scheduleId: schedule.id,
    });

    return true;
  }

  static async resumeOneTime({ resourceId, scheduleId }: OwnedScheduleInput) {
    if (!isUuid(scheduleId)) {
      return false;
    }

    const [schedule] = await database
      .select()
      .from(oneTimeSchedules)
      .where(
        and(
          eq(oneTimeSchedules.id, scheduleId),
          eq(oneTimeSchedules.resourceId, resourceId),
          eq(oneTimeSchedules.status, 'paused'),
        ),
      )
      .limit(1);

    if (!schedule) {
      return false;
    }

    this.#assertOneTimeRunAt(schedule.runAt);
    const revision = schedule.revision + 1;
    const [reserved] = await database
      .update(oneTimeSchedules)
      .set({
        revision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(oneTimeSchedules.id, scheduleId),
          eq(oneTimeSchedules.resourceId, resourceId),
          eq(oneTimeSchedules.status, 'paused'),
          eq(oneTimeSchedules.revision, schedule.revision),
        ),
      )
      .returning({ id: oneTimeSchedules.id });

    if (!reserved) {
      return false;
    }

    const messageId = await this.#publishOneTime({
      scheduleId,
      revision,
      runAt: schedule.runAt,
      title: schedule.title,
    });

    let resumed;

    try {
      [resumed] = await database
        .update(oneTimeSchedules)
        .set({
          status: 'active',
          revision,
          qstashMessageId: messageId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(oneTimeSchedules.id, scheduleId),
            eq(oneTimeSchedules.resourceId, resourceId),
            eq(oneTimeSchedules.status, 'paused'),
            eq(oneTimeSchedules.revision, revision),
          ),
        )
        .returning({ id: oneTimeSchedules.id });
    } catch (error) {
      await this.#compensateOneTimePublish(messageId, error);
      throw error;
    }

    if (!resumed) {
      await this.#cancelOneTimeMessageBestEffort({ messageId, scheduleId });
      return false;
    }

    return true;
  }

  static async updateOneTime(input: UpdateOneTimeScheduleInput) {
    if (!isUuid(input.scheduleId)) {
      return false;
    }

    const [current] = await database
      .select()
      .from(oneTimeSchedules)
      .where(
        and(
          eq(oneTimeSchedules.id, input.scheduleId),
          eq(oneTimeSchedules.resourceId, input.resourceId),
          inArray(oneTimeSchedules.status, ['active', 'paused']),
        ),
      )
      .limit(1);

    if (!current) {
      return false;
    }

    const runAt = input.runAt ? new Date(input.runAt) : current.runAt;
    this.#assertOneTimeRunAt(runAt);
    const revision = current.revision + 1;
    const title = input.title ?? current.title;

    if (current.status === 'paused') {
      const [updated] = await database
        .update(oneTimeSchedules)
        .set({
          title,
          prompt: input.prompt ?? current.prompt,
          runAt,
          revision,
          qstashMessageId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(oneTimeSchedules.id, current.id),
            eq(oneTimeSchedules.resourceId, input.resourceId),
            eq(oneTimeSchedules.status, 'paused'),
            eq(oneTimeSchedules.revision, current.revision),
          ),
        )
        .returning({ id: oneTimeSchedules.id });

      if (!updated) {
        return false;
      }

      await this.#cancelOneTimeMessageBestEffort({
        messageId: current.qstashMessageId,
        scheduleId: current.id,
      });
      return true;
    }

    const messageId = await this.#publishOneTime({
      scheduleId: current.id,
      revision,
      runAt,
      title,
      deduplicationId: `agent-schedule-${current.id}-${revision}-${crypto.randomUUID()}`,
    });

    let updated;

    try {
      [updated] = await database
        .update(oneTimeSchedules)
        .set({
          title,
          prompt: input.prompt ?? current.prompt,
          runAt,
          revision,
          qstashMessageId: messageId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(oneTimeSchedules.id, current.id),
            eq(oneTimeSchedules.resourceId, input.resourceId),
            eq(oneTimeSchedules.revision, current.revision),
            eq(oneTimeSchedules.status, 'active'),
          ),
        )
        .returning({ id: oneTimeSchedules.id });
    } catch (error) {
      await this.#compensateOneTimePublish(messageId, error);
      throw error;
    }

    if (!updated) {
      await this.#cancelOneTimeMessageBestEffort({
        messageId,
        scheduleId: current.id,
      });
      return false;
    }

    await this.#cancelOneTimeMessageBestEffort({
      messageId: current.qstashMessageId,
      scheduleId: current.id,
    });

    return true;
  }

  static async executeOneTime({
    mastra: _mastra,
    scheduleId,
    revision,
  }: {
    /** Kept optional for compatibility with older callers; delivery is Chat SDK-owned. */
    mastra?: Mastra;
    scheduleId: string;
    revision: number;
  }) {
    const now = new Date();
    const [schedule] = await database
      .update(oneTimeSchedules)
      .set({ status: 'running', executionStartedAt: now, updatedAt: now })
      .where(
        and(
          eq(oneTimeSchedules.id, scheduleId),
          eq(oneTimeSchedules.revision, revision),
          lt(oneTimeSchedules.runAt, new Date(now.getTime() + EARLY_DELIVERY_TOLERANCE_MS)),
          or(
            eq(oneTimeSchedules.status, 'active'),
            and(
              eq(oneTimeSchedules.status, 'running'),
              lt(oneTimeSchedules.executionStartedAt, new Date(now.getTime() - RUN_LEASE_MS)),
            ),
          ),
        ),
      )
      .returning();

    if (!schedule) {
      return this.#oneTimeClaimMissStatus({ scheduleId, revision, now });
    }

    try {
      await this.#getScheduleDelivery().runScheduled({
        resourceId: schedule.resourceId,
        threadId: schedule.threadId,
        prompt: schedule.prompt,
        source: 'one-time-schedule',
        deliveryId: schedule.qstashMessageId ?? `one-time-${schedule.id}-${revision}`,
      });

      await database
        .update(oneTimeSchedules)
        .set({ status: 'completed', executionStartedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(oneTimeSchedules.id, schedule.id),
            eq(oneTimeSchedules.revision, revision),
            eq(oneTimeSchedules.status, 'running'),
          ),
        );

      return { status: 'completed' as const };
    } catch (error) {
      await database
        .update(oneTimeSchedules)
        .set({ status: 'active', executionStartedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(oneTimeSchedules.id, schedule.id),
            eq(oneTimeSchedules.revision, revision),
            eq(oneTimeSchedules.status, 'running'),
          ),
        );
      throw error;
    }
  }

  static async executeRecurring({
    mastra,
    scheduleId,
    triggerVersion,
    deliveryId,
    respectOccurrenceCompletion,
  }: ExecuteRecurringScheduleInput) {
    const schedule = await mastra.schedules.get(scheduleId);

    if (
      !schedule ||
      !('agentId' in schedule) ||
      schedule.agentId !== 'agent' ||
      !schedule.resourceId ||
      !schedule.threadId ||
      !schedule.cron ||
      schedule.status !== 'active'
    ) {
      return { status: 'inactive_or_missing' as const };
    }

    if (this.#recurringTriggerVersion(schedule) !== triggerVersion) {
      // QStash and Mastra cannot be updated transactionally. If a process
      // stopped between those writes, every future QStash invocation would
      // otherwise carry the stale version forever. Mastra is authoritative;
      // repair the provider definition before acknowledging this delivery.
      await this.#repairRecurringTrigger(mastra.schedules, schedule);
      return { status: 'stale_trigger_repaired' as const };
    }

    const timeZone = schedule.timezone ?? 'UTC';

    if (respectOccurrenceCompletion) {
      // QStash can expire a delivery record before this handler reads it. The
      // provider timestamp is preferred because it preserves delayed delivery
      // semantics; a request-time fallback still lets an early completion mark
      // the occurrence that is currently being delivered.
      const firedAt = (await this.#recurringDeliveryCreatedAt(deliveryId)) ?? new Date();

      if (
        (await this.prepareOccurrence({
          scheduleId: schedule.id,
          cron: schedule.cron,
          firedAt,
          timeZone,
        })) === null
      ) {
        return { status: 'occurrence_completed_early' as const };
      }
    }

    const claim = await this.#claimRecurringRun({
      deliveryId,
      scheduleId: schedule.id,
      resourceId: schedule.resourceId,
    });

    if (claim !== 'claimed') {
      return { status: claim as 'already_handled' | 'retry_later' };
    }

    try {
      await this.#getScheduleDelivery().runScheduled({
        resourceId: schedule.resourceId,
        threadId: schedule.threadId,
        prompt: schedule.prompt,
        timeZone,
        source: 'recurring-schedule',
        deliveryId,
      });

      await database
        .update(recurringScheduleRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recurringScheduleRuns.deliveryId, deliveryId),
            eq(recurringScheduleRuns.status, 'running'),
          ),
        );

      return { status: 'completed' as const };
    } catch (error) {
      await database
        .update(recurringScheduleRuns)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(recurringScheduleRuns.deliveryId, deliveryId));
      throw error;
    }
  }

  static async verifyRequest(request: Request) {
    const signature = request.headers.get('upstash-signature');

    if (!signature) {
      return false;
    }

    try {
      return await this.#receiver.verify({
        signature,
        body: await request.clone().text(),
        url: request.url,
        clockTolerance: QSTASH_SIGNATURE_CLOCK_TOLERANCE_SECONDS,
        upstashRegion: request.headers.get('upstash-region') ?? undefined,
      });
    } catch (error) {
      // Signature failures are expected for stale/replayed requests and must
      // return a normal 401 from the route rather than turning into a 500.
      logger.warn('QStash signature verification failed', {
        error: describeSchedulingError(error),
      });
      return false;
    }
  }

  static async handleFailureCallback({
    mastra,
    payload,
  }: {
    mastra?: MastraUnion;
    payload: ScheduleFailureCallbackPayload;
  }) {
    const sourcePayload = this.#decodeFailureSourceBody(payload.sourceBody);

    if (sourcePayload.kind === 'one_time') {
      return this.#handleOneTimeFailure({
        payload,
        sourcePayload,
      });
    }

    return this.#handleRecurringFailure({
      mastra,
      payload,
      sourcePayload,
    });
  }

  static async #handleOneTimeFailure({
    payload,
    sourcePayload,
  }: {
    payload: ScheduleFailureCallbackPayload;
    sourcePayload: Extract<ScheduleExecutionPayload, { kind: 'one_time' }>;
  }) {
    const [schedule] = await database
      .select()
      .from(oneTimeSchedules)
      .where(eq(oneTimeSchedules.id, sourcePayload.scheduleId))
      .limit(1);

    if (
      !schedule ||
      schedule.revision !== sourcePayload.revision ||
      (schedule.qstashMessageId && schedule.qstashMessageId !== payload.sourceMessageId)
    ) {
      return { status: 'stale_or_missing' as const };
    }

    const now = new Date();
    const notificationLeaseExpiresAt = new Date(now.getTime() - RUN_LEASE_MS);
    const [claimed] = await database
      .update(oneTimeSchedules)
      .set({ status: 'failed', executionStartedAt: now, updatedAt: now })
      .where(
        and(
          eq(oneTimeSchedules.id, sourcePayload.scheduleId),
          eq(oneTimeSchedules.revision, sourcePayload.revision),
          or(
            inArray(oneTimeSchedules.status, ['active', 'running']),
            and(
              eq(oneTimeSchedules.status, 'failed'),
              or(
                isNull(oneTimeSchedules.executionStartedAt),
                lt(oneTimeSchedules.executionStartedAt, notificationLeaseExpiresAt),
              ),
            ),
          ),
        ),
      )
      .returning();

    if (!claimed) {
      return { status: 'already_handled' as const };
    }

    try {
      await this.#notifyFailure({
        resourceId: schedule.resourceId,
        threadId: schedule.threadId,
        scheduleId: schedule.id,
        title: schedule.title,
        kind: 'one-time reminder',
      });
    } catch (error) {
      try {
        await database
          .update(oneTimeSchedules)
          .set({ executionStartedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(oneTimeSchedules.id, schedule.id),
              eq(oneTimeSchedules.revision, sourcePayload.revision),
              eq(oneTimeSchedules.status, 'failed'),
              eq(oneTimeSchedules.executionStartedAt, now),
            ),
          );
      } catch (stateError) {
        error = new AggregateError(
          [error, stateError],
          'The scheduling failure notification could not be delivered or reset for retry.',
        );
      }

      throw error;
    }

    await database
      .update(oneTimeSchedules)
      .set({ executionStartedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(oneTimeSchedules.id, schedule.id),
          eq(oneTimeSchedules.revision, sourcePayload.revision),
          eq(oneTimeSchedules.status, 'failed'),
          eq(oneTimeSchedules.executionStartedAt, now),
        ),
      );

    logger.warn('One-time scheduled delivery failure was reported', {
      messageId: payload.sourceMessageId,
      scheduleId: schedule.id,
    });

    return { status: 'failure_notified' as const };
  }

  static async #handleRecurringFailure({
    mastra,
    payload,
    sourcePayload,
  }: {
    mastra?: MastraUnion;
    payload: ScheduleFailureCallbackPayload;
    sourcePayload: Extract<ScheduleExecutionPayload, { kind: 'recurring' }>;
  }) {
    if (!mastra) {
      return { status: 'stale_or_missing' as const };
    }

    const schedule = await mastra.schedules.get(sourcePayload.scheduleId);

    if (
      !schedule ||
      !('agentId' in schedule) ||
      schedule.agentId !== 'agent' ||
      !schedule.resourceId ||
      !schedule.threadId ||
      this.#recurringTriggerVersion(schedule) !== sourcePayload.triggerVersion
    ) {
      return { status: 'stale_or_missing' as const };
    }

    const now = new Date();
    let [claimed] = await database
      .update(recurringScheduleRuns)
      .set({ status: 'failed', completedAt: now, updatedAt: now })
      .where(
        and(
          eq(recurringScheduleRuns.deliveryId, payload.sourceMessageId),
          or(
            eq(recurringScheduleRuns.status, 'running'),
            and(
              eq(recurringScheduleRuns.status, 'failed'),
              isNull(recurringScheduleRuns.completedAt),
            ),
          ),
        ),
      )
      .returning({ deliveryId: recurringScheduleRuns.deliveryId });

    if (!claimed) {
      [claimed] = await database
        .insert(recurringScheduleRuns)
        .values({
          deliveryId: payload.sourceMessageId,
          scheduleId: schedule.id,
          resourceId: schedule.resourceId,
          status: 'failed',
          executionStartedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ deliveryId: recurringScheduleRuns.deliveryId });
    }

    if (!claimed) {
      return { status: 'already_handled' as const };
    }

    const title =
      'name' in schedule && typeof schedule.name === 'string' ? schedule.name : 'Recurring task';

    try {
      await this.#notifyFailure({
        resourceId: schedule.resourceId,
        threadId: schedule.threadId,
        scheduleId: schedule.id,
        title,
        kind: 'recurring task',
      });
    } catch (error) {
      try {
        await database
          .update(recurringScheduleRuns)
          .set({ completedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(recurringScheduleRuns.deliveryId, payload.sourceMessageId),
              eq(recurringScheduleRuns.status, 'failed'),
              eq(recurringScheduleRuns.completedAt, now),
            ),
          );
      } catch (stateError) {
        error = new AggregateError(
          [error, stateError],
          'The scheduling failure notification could not be delivered or reset for retry.',
        );
      }

      throw error;
    }

    await database
      .update(recurringScheduleRuns)
      .set({ completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(recurringScheduleRuns.deliveryId, payload.sourceMessageId),
          eq(recurringScheduleRuns.status, 'failed'),
          eq(recurringScheduleRuns.completedAt, now),
        ),
      );

    logger.warn('Recurring scheduled delivery failure was reported', {
      messageId: payload.sourceMessageId,
      scheduleId: schedule.id,
    });

    return { status: 'failure_notified' as const };
  }

  static async #notifyFailure({
    resourceId,
    threadId,
    scheduleId,
    title,
    kind,
  }: {
    resourceId: string;
    threadId: string;
    scheduleId: string;
    title: string;
    kind: 'one-time reminder' | 'recurring task';
  }) {
    const outcome =
      kind === 'one-time reminder'
        ? 'It is marked as failed; ask me to retry or recreate it.'
        : 'This occurrence failed, but the recurring task remains active.';

    await this.#getScheduleDelivery().postToThread(
      threadId,
      `I couldn't deliver the ${kind} "${title}" because the scheduling service failed after one retry. ${outcome}`,
    );

    logger.info('Scheduled failure notification posted', { resourceId, scheduleId, threadId });
  }

  static #getScheduleDelivery() {
    if (!scheduleDelivery) {
      throw new Error('Scheduling delivery is not configured.');
    }

    return scheduleDelivery;
  }

  static #decodeFailureSourceBody(sourceBody: string) {
    let decoded: string;

    try {
      decoded = Buffer.from(sourceBody, 'base64').toString('utf8');
    } catch (error) {
      throw new Error('QStash returned an invalid failure callback body.', { cause: error });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(decoded);
    } catch (error) {
      throw new Error('QStash returned an invalid failure callback body.', { cause: error });
    }

    const result = ScheduleExecutionPayloadSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error('QStash returned an unknown scheduled delivery payload.');
    }

    return result.data;
  }

  static get #qstash() {
    return new Client({ token: this.#requiredEnvironment('QSTASH_TOKEN') });
  }

  static get #receiver() {
    return new Receiver({
      currentSigningKey: this.#requiredEnvironment('QSTASH_CURRENT_SIGNING_KEY'),
      nextSigningKey: this.#requiredEnvironment('QSTASH_NEXT_SIGNING_KEY'),
      devMode: false,
    });
  }

  static get #executionUrl() {
    return new URL('/api/jobs/schedules/execute', this.#publicBaseUrl).toString();
  }

  static get #failureCallbackUrl() {
    return new URL('/api/jobs/schedules/failure', this.#publicBaseUrl).toString();
  }

  static get #publicBaseUrl() {
    const baseUrl =
      process.env.AGENT_PUBLIC_URL ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL;

    if (!baseUrl) {
      throw new Error('AGENT_PUBLIC_URL or a Vercel deployment URL is required for scheduling.');
    }

    return baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  }

  static async #publishOneTime({
    scheduleId,
    revision,
    runAt,
    title,
    deduplicationId = `agent-schedule-${scheduleId}-${revision}`,
  }: {
    scheduleId: string;
    revision: number;
    runAt: Date;
    title: string;
    deduplicationId?: string;
  }) {
    const result = await this.#qstash.publishJSON({
      url: this.#executionUrl,
      body: { kind: 'one_time', scheduleId, revision },
      notBefore: Math.floor(runAt.getTime() / 1_000),
      retries: 1,
      timeout: QSTASH_EXECUTION_TIMEOUT_SECONDS,
      failureCallback: this.#failureCallbackUrl,
      deduplicationId,
      label: ['agent-reminder', this.#slug(title)],
    });
    const messageId = Array.isArray(result) ? undefined : result.messageId;

    if (!messageId) {
      throw new Error('QStash did not return a message id.');
    }

    if (!Array.isArray(result) && result.deduplicated) {
      // QStash returns the original message id when a deterministic
      // deduplication key is reused. Treat that response as an idempotent
      // success and persist the existing id; rejecting it would leave the
      // schedule marked failed even though its delivery is still queued.
      logger.info('Reused an existing QStash one-time delivery', {
        deduplicationId,
        messageId,
        scheduleId,
      });
    }

    return messageId;
  }

  static async #compensateOneTimePublish(messageId: string, cause: unknown) {
    try {
      await this.#qstash.messages.cancel(messageId);
    } catch (compensationError) {
      throw new AggregateError(
        [cause, compensationError],
        'The one-time reminder update failed and its QStash message could not be cancelled.',
      );
    }
  }

  static async #cancelOneTimeMessageBestEffort({
    messageId,
    scheduleId,
  }: {
    messageId: string | null;
    scheduleId: string;
  }) {
    if (!messageId) {
      return;
    }

    try {
      await this.#qstash.messages.cancel(messageId);
    } catch (error) {
      // The database revision is the delivery fence. A superseded QStash
      // message is harmless because its old revision will be acknowledged
      // without executing, so cancellation failure must not roll back an
      // otherwise successful update.
      logger.warn('Superseded one-time delivery could not be cancelled', {
        error: describeSchedulingError(error),
        messageId,
        scheduleId,
      });
    }
  }

  static async #recurringDeliveryCreatedAt(deliveryId: string) {
    try {
      const message = await this.#qstash.messages.get(deliveryId);
      const createdAt = new Date(message.createdAt);

      if (Number.isNaN(createdAt.getTime())) {
        throw new Error('QStash returned an invalid recurring delivery creation time.');
      }

      return createdAt;
    } catch (error) {
      // QStash removes a message shortly after delivery. A 404 here must not turn an
      // otherwise valid reminder into a retry storm; occurrence completion is only an
      // optimization, so proceed without the early-completion check when its timestamp
      // is unavailable.
      logger.warn('Recurring delivery timestamp unavailable; continuing execution', {
        deliveryId,
        error: describeSchedulingError(error),
      });
      return undefined;
    }
  }

  static async #repairRecurringTrigger(schedules: Mastra['schedules'], schedule: AgentSchedule) {
    if (schedule.status !== 'active' && schedule.status !== 'paused') {
      return schedule;
    }

    let repaired = schedule;
    let triggerVersion = this.#recurringTriggerVersion(schedule);

    if (!triggerVersion) {
      triggerVersion = crypto.randomUUID();
      const updated = await schedules.update(schedule.id, {
        metadata: {
          ...schedule.metadata,
          triggerVersion,
        },
      });

      if (!('agentId' in updated) || updated.agentId !== 'agent') {
        throw new Error('The recurring schedule changed while its delivery was repaired.');
      }

      repaired = updated;
    }

    await this.#upsertRecurringTrigger({
      scheduleId: repaired.id,
      title: repaired.name ?? 'Recurring task',
      cron: repaired.cron,
      timeZone: repaired.timezone ?? 'UTC',
      triggerVersion,
    });

    if (repaired.status === 'paused') {
      await this.#qstash.schedules.pause({
        schedule: this.#recurringTriggerId(repaired.id),
      });
    }

    return repaired;
  }

  static async #upsertRecurringTrigger({
    scheduleId,
    title,
    cron,
    timeZone,
    triggerVersion,
  }: {
    scheduleId: string;
    title: string;
    cron: string;
    timeZone: string;
    triggerVersion?: string;
  }) {
    await this.#qstash.schedules.create({
      destination: this.#executionUrl,
      scheduleId: this.#recurringTriggerId(scheduleId),
      body: JSON.stringify({
        kind: 'recurring',
        scheduleId,
        ...(triggerVersion ? { triggerVersion } : {}),
      }),
      headers: {
        'content-type': 'application/json',
      },
      cron: `CRON_TZ=${timeZone} ${cron}`,
      retries: 1,
      timeout: QSTASH_EXECUTION_TIMEOUT_SECONDS,
      failureCallback: this.#failureCallbackUrl,
      label: ['agent-recurring', this.#slug(title)],
    });
  }

  static async #withRecurringTriggerState<T extends { id: string }>(schedule: T) {
    try {
      let trigger = await this.#qstash.schedules.get(this.#recurringTriggerId(schedule.id));

      if (this.#recurringTriggerNeedsRepair(schedule, trigger)) {
        await this.#reconcileRecurringTrigger(schedule);
        trigger = await this.#qstash.schedules.get(this.#recurringTriggerId(schedule.id));
      }

      return this.#recurringScheduleWithTrigger(schedule, trigger);
    } catch (error) {
      if (
        !isQStashNotFound(error) ||
        !('cron' in schedule) ||
        typeof schedule.cron !== 'string' ||
        !('status' in schedule) ||
        (schedule.status !== 'active' && schedule.status !== 'paused')
      ) {
        return this.#recurringScheduleWithUnavailableTrigger(schedule);
      }

      try {
        await this.#reconcileRecurringTrigger(schedule);

        const trigger = await this.#qstash.schedules.get(this.#recurringTriggerId(schedule.id));

        return this.#recurringScheduleWithTrigger(schedule, trigger);
      } catch {
        return this.#recurringScheduleWithUnavailableTrigger(schedule);
      }
    }
  }

  static async #reconcileRecurringTrigger(schedule: {
    id: string;
    cron?: unknown;
    name?: unknown;
    timezone?: unknown;
    status?: unknown;
    metadata?: unknown;
  }) {
    if (
      typeof schedule.cron !== 'string' ||
      (schedule.status !== 'active' && schedule.status !== 'paused')
    ) {
      return;
    }

    await this.#upsertRecurringTrigger({
      scheduleId: schedule.id,
      title: typeof schedule.name === 'string' ? schedule.name : 'Recurring task',
      cron: schedule.cron,
      timeZone: typeof schedule.timezone === 'string' ? schedule.timezone : 'UTC',
      triggerVersion: this.#recurringTriggerVersion(schedule),
    });

    if (schedule.status === 'paused') {
      await this.#qstash.schedules.pause({
        schedule: this.#recurringTriggerId(schedule.id),
      });
    }
  }

  static #recurringTriggerNeedsRepair(schedule: unknown, trigger: QStashSchedule) {
    if (!schedule || typeof schedule !== 'object' || !('id' in schedule)) {
      return false;
    }

    const status = 'status' in schedule ? schedule.status : undefined;

    if (status !== 'active' && status !== 'paused') {
      return false;
    }

    let body: unknown;

    try {
      const encodedBody =
        'body' in trigger && trigger.body
          ? trigger.body
          : 'bodyBase64' in trigger && trigger.bodyBase64
            ? Buffer.from(trigger.bodyBase64, 'base64').toString('utf8')
            : undefined;
      body = encodedBody ? JSON.parse(encodedBody) : undefined;
    } catch {
      return true;
    }

    const payload = ScheduleExecutionPayloadSchema.safeParse(body);
    const expectedVersion = this.#recurringTriggerVersion(schedule);
    const expectedPaused = status === 'paused';

    return (
      !payload.success ||
      payload.data.kind !== 'recurring' ||
      payload.data.scheduleId !== schedule.id ||
      payload.data.triggerVersion !== expectedVersion ||
      trigger.isPaused !== expectedPaused
    );
  }

  static #recurringScheduleWithTrigger<T extends { id: string }>(
    schedule: T,
    trigger: QStashSchedule,
  ) {
    return {
      ...schedule,
      trigger: {
        provider: 'qstash' as const,
        scheduleId: trigger.scheduleId,
        paused: trigger.isPaused,
        lastRunAt: trigger.lastScheduleTime,
        nextRunAt: trigger.nextScheduleTime,
        lastRunStates: trigger.lastScheduleStates,
      },
    };
  }

  static #recurringScheduleWithUnavailableTrigger<T extends { id: string }>(schedule: T) {
    return {
      ...schedule,
      trigger: {
        provider: 'qstash' as const,
        unavailable: true as const,
      },
    };
  }

  static #recurringTriggerVersion(schedule: unknown) {
    if (!schedule || typeof schedule !== 'object' || !('metadata' in schedule)) {
      return undefined;
    }

    const metadata = schedule.metadata;
    const triggerVersion =
      metadata && typeof metadata === 'object' && 'triggerVersion' in metadata
        ? metadata.triggerVersion
        : undefined;
    return typeof triggerVersion === 'string' && triggerVersion ? triggerVersion : undefined;
  }

  static async #oneTimeClaimMissStatus({
    scheduleId,
    revision,
    now,
  }: {
    scheduleId: string;
    revision: number;
    now: Date;
  }) {
    const [current] = await database
      .select({
        revision: oneTimeSchedules.revision,
        status: oneTimeSchedules.status,
        executionStartedAt: oneTimeSchedules.executionStartedAt,
      })
      .from(oneTimeSchedules)
      .where(eq(oneTimeSchedules.id, scheduleId))
      .limit(1);

    if (!current || current.revision !== revision) {
      return { status: 'already_handled' as const };
    }

    if (
      current.status === 'active' ||
      (current.status === 'running' &&
        (!current.executionStartedAt ||
          current.executionStartedAt.getTime() > now.getTime() - RUN_LEASE_MS))
    ) {
      return { status: 'retry_later' as const };
    }

    return { status: 'already_handled' as const };
  }

  static async #claimRecurringRun({
    deliveryId,
    scheduleId,
    resourceId,
  }: {
    deliveryId: string;
    scheduleId: string;
    resourceId: string;
  }) {
    const now = new Date();
    const [created] = await database
      .insert(recurringScheduleRuns)
      .values({
        deliveryId,
        scheduleId,
        resourceId,
        status: 'running',
        executionStartedAt: now,
      })
      .onConflictDoNothing()
      .returning({ deliveryId: recurringScheduleRuns.deliveryId });

    if (created) {
      return 'claimed' as const;
    }

    const [reclaimed] = await database
      .update(recurringScheduleRuns)
      .set({
        status: 'running',
        executionStartedAt: now,
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(recurringScheduleRuns.deliveryId, deliveryId),
          or(
            and(
              eq(recurringScheduleRuns.status, 'failed'),
              isNull(recurringScheduleRuns.completedAt),
            ),
            and(
              eq(recurringScheduleRuns.status, 'running'),
              lt(recurringScheduleRuns.executionStartedAt, new Date(now.getTime() - RUN_LEASE_MS)),
            ),
          ),
        ),
      )
      .returning({ deliveryId: recurringScheduleRuns.deliveryId });

    if (reclaimed) {
      return 'claimed' as const;
    }

    const [current] = await database
      .select({
        status: recurringScheduleRuns.status,
        completedAt: recurringScheduleRuns.completedAt,
      })
      .from(recurringScheduleRuns)
      .where(eq(recurringScheduleRuns.deliveryId, deliveryId))
      .limit(1);

    if (
      !current ||
      current.status === 'running' ||
      (current.status === 'failed' && !current.completedAt)
    ) {
      return 'retry_later' as const;
    }

    return 'already_handled' as const;
  }

  static #recurringTriggerId(scheduleId: string) {
    return `agent-recurring-${scheduleId}`;
  }

  static #assertOneTimeRunAt(runAt: Date) {
    const delay = runAt.getTime() - Date.now();

    if (delay <= 0 || delay > MAX_ONE_TIME_DELAY_MS) {
      throw new Error('One-time reminders must be in the future and no more than seven days away.');
    }
  }

  static #assertSupportedCron(cron: string) {
    const [minute, hour, dayOfMonth, month, dayOfWeek, ...rest] = cron.trim().split(/\s+/);
    const numericMinute = Number(minute);
    const validHour = hour === '*' || (/^\d{1,2}$/.test(hour ?? '') && Number(hour) <= 23);

    if (
      rest.length > 0 ||
      !Number.isInteger(numericMinute) ||
      numericMinute < 0 ||
      numericMinute > 59 ||
      !validHour ||
      dayOfMonth !== '*' ||
      month !== '*' ||
      !dayOfWeek
    ) {
      throw new Error(
        'Recurring schedules must use an hourly-or-less-frequent five-part cron expression.',
      );
    }
  }

  static #requiredEnvironment(name: string) {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`${name} is required for scheduling.`);
    }

    return value;
  }

  static #slug(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  static #localDate(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
  }
}

type CreateOneTimeScheduleInput = {
  resourceId: string;
  threadId: string;
  title: string;
  prompt: string;
  runAt: string;
  idempotencyKey?: string;
};

type CreateRecurringScheduleInput = {
  schedules: Mastra['schedules'];
  resourceId: string;
  threadId: string;
  title: string;
  prompt: string;
  cron: string;
  timeZone: string;
  idempotencyKey?: string;
};

type OwnedScheduleInput = {
  resourceId: string;
  scheduleId: string;
};

type UpdateOneTimeScheduleInput = OwnedScheduleInput & {
  title?: string;
  prompt?: string;
  runAt?: string;
};

type UpdateRecurringScheduleInput = OwnedScheduleInput & {
  schedules: Mastra['schedules'];
  title?: string;
  prompt?: string;
  cron?: string;
  timeZone?: string;
};

type ChangeRecurringScheduleInput = OwnedScheduleInput & {
  schedules: Mastra['schedules'];
  action: 'pause' | 'resume' | 'cancel';
};

type ExecuteRecurringScheduleInput = {
  mastra: MastraUnion;
  scheduleId: string;
  triggerVersion?: string;
  deliveryId: string;
  respectOccurrenceCompletion: boolean;
};

type QStashSchedule = Awaited<ReturnType<Client['schedules']['get']>>;
type OneTimeSchedule = typeof oneTimeSchedules.$inferSelect;

function describeSchedulingError(error: unknown) {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: String(error).slice(0, 500) };
  }

  return { name: error.name, message: error.message.slice(0, 500) };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isQStashNotFound(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404);
}

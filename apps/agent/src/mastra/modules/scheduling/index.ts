import type { Mastra } from '@mastra/core/mastra';
import type { MastraUnion } from '@mastra/core/tools';

import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { Client, Receiver } from '@upstash/qstash';
import { Cron } from 'croner';
import { and, count, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { database } from '../../../infrastructure/database';
import {
  oneTimeSchedules,
  recurringScheduleRuns,
  scheduleOccurrenceCompletions,
} from '../../../infrastructure/database/schema';

const ACTIVE_ONE_TIME_LIMIT = 10;
const ACTIVE_RECURRING_LIMIT = 10;
const MAX_ONE_TIME_DELAY_MS = 7 * 24 * 60 * 60 * 1_000;
const EARLY_DELIVERY_TOLERANCE_MS = 60_000;
const RUN_LEASE_MS = 5 * 60 * 1_000;

export class SchedulingService {
  static async createOneTime(input: CreateOneTimeScheduleInput) {
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

    const [schedule] = await database
      .insert(oneTimeSchedules)
      .values({ ...input, runAt })
      .returning();

    if (!schedule) {
      throw new Error('The reminder could not be saved.');
    }

    try {
      const messageId = await this.#publishOneTime({
        scheduleId: schedule.id,
        revision: schedule.revision,
        runAt,
        title: input.title,
      });

      await database
        .update(oneTimeSchedules)
        .set({ qstashMessageId: messageId, updatedAt: new Date() })
        .where(eq(oneTimeSchedules.id, schedule.id));

      return { ...schedule, qstashMessageId: messageId };
    } catch (error) {
      await database
        .update(oneTimeSchedules)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(oneTimeSchedules.id, schedule.id));
      throw error;
    }
  }

  static async createRecurring(input: CreateRecurringScheduleInput) {
    this.#assertSupportedCron(input.cron);

    const existing = await input.schedules.list({
      agentId: 'agent',
      resourceId: input.resourceId,
      status: 'active',
    });

    if (existing.length >= ACTIVE_RECURRING_LIMIT) {
      throw new Error('You already have 10 active recurring schedules.');
    }

    const schedule = await input.schedules.create({
      agentId: 'agent',
      name: input.title,
      prompt: input.prompt,
      cron: input.cron,
      timezone: input.timeZone,
      threadId: input.threadId,
      resourceId: input.resourceId,
      ifIdle: { behavior: 'wake' },
      ifActive: { behavior: 'deliver' },
      metadata: { kind: 'recurring', triggerProvider: 'qstash' },
    });

    try {
      await this.#upsertRecurringTrigger({
        scheduleId: schedule.id,
        title: input.title,
        cron: input.cron,
        timeZone: input.timeZone,
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

    await this.#upsertRecurringTrigger({
      scheduleId: schedule.id,
      title,
      cron,
      timeZone,
    });

    try {
      await input.schedules.update(input.scheduleId, {
        name: input.title,
        prompt: input.prompt,
        cron: input.cron,
        timezone: input.timeZone,
      });
    } catch (error) {
      try {
        await this.#upsertRecurringTrigger({
          scheduleId: schedule.id,
          title: schedule.name ?? 'Recurring task',
          cron: schedule.cron,
          timeZone: schedule.timezone ?? 'UTC',
        });
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
      await input.schedules.delete(input.scheduleId);
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

    if (!schedule || !('resourceId' in schedule) || schedule.resourceId !== resourceId) {
      return false;
    }

    await this.executeRecurring({
      mastra,
      scheduleId,
      deliveryId: `manual-${crypto.randomUUID()}`,
      respectOccurrenceCompletion: false,
    });

    return true;
  }

  static async completeOccurrence({
    schedules,
    resourceId,
    scheduleId,
  }: OwnedScheduleInput & { schedules: Mastra['schedules'] }) {
    const [oneTime] = await database
      .update(oneTimeSchedules)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(
        and(
          eq(oneTimeSchedules.id, scheduleId),
          eq(oneTimeSchedules.resourceId, resourceId),
          inArray(oneTimeSchedules.status, ['active', 'paused']),
        ),
      )
      .returning();

    if (oneTime) {
      if (oneTime.qstashMessageId) {
        await this.#qstash.messages.cancel(oneTime.qstashMessageId);
      }

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
    const nextRun = new Cron(recurring.cron, {
      timezone: timeZone,
      paused: true,
    }).nextRun(new Date(Date.now() - EARLY_DELIVERY_TOLERANCE_MS));

    if (!nextRun) {
      return null;
    }

    const localDate = this.#localDate(nextRun, timeZone);

    if (localDate !== this.#localDate(new Date(), timeZone)) {
      throw new Error('That recurring task has no pending occurrence today.');
    }

    await database
      .insert(scheduleOccurrenceCompletions)
      .values({ scheduleId: recurring.id, resourceId, localDate })
      .onConflictDoNothing();

    return { kind: 'recurring' as const, localDate };
  }

  static async prepareOccurrence({
    scheduleId,
    firedAt,
    timeZone,
  }: {
    scheduleId: string;
    firedAt: Date;
    timeZone: string;
  }) {
    const [completion] = await database
      .select({ scheduleId: scheduleOccurrenceCompletions.scheduleId })
      .from(scheduleOccurrenceCompletions)
      .where(
        and(
          eq(scheduleOccurrenceCompletions.scheduleId, scheduleId),
          eq(scheduleOccurrenceCompletions.localDate, this.#localDate(firedAt, timeZone)),
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
    const [oneTime] = await database
      .select()
      .from(oneTimeSchedules)
      .where(and(eq(oneTimeSchedules.id, scheduleId), eq(oneTimeSchedules.resourceId, resourceId)))
      .limit(1);

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

    if (schedule.qstashMessageId) {
      await this.#qstash.messages.cancel(schedule.qstashMessageId);
    }

    return true;
  }

  static async pauseOneTime({ resourceId, scheduleId }: OwnedScheduleInput) {
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

    if (schedule.qstashMessageId) {
      await this.#qstash.messages.cancel(schedule.qstashMessageId);
    }

    return true;
  }

  static async resumeOneTime({ resourceId, scheduleId }: OwnedScheduleInput) {
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
    const messageId = await this.#publishOneTime({
      scheduleId,
      revision,
      runAt: schedule.runAt,
      title: schedule.title,
    });

    await database
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
          eq(oneTimeSchedules.revision, schedule.revision),
        ),
      );

    return true;
  }

  static async updateOneTime(input: UpdateOneTimeScheduleInput) {
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

    await database
      .update(oneTimeSchedules)
      .set({
        status: 'paused',
        title,
        prompt: input.prompt ?? current.prompt,
        runAt,
        revision,
        updatedAt: new Date(),
      })
      .where(
        and(eq(oneTimeSchedules.id, current.id), eq(oneTimeSchedules.revision, current.revision)),
      );

    if (current.qstashMessageId) {
      await this.#qstash.messages.cancel(current.qstashMessageId);
    }

    if (current.status === 'paused') {
      return true;
    }

    const messageId = await this.#publishOneTime({
      scheduleId: current.id,
      revision,
      runAt,
      title,
    });

    await database
      .update(oneTimeSchedules)
      .set({ status: 'active', qstashMessageId: messageId, updatedAt: new Date() })
      .where(
        and(
          eq(oneTimeSchedules.id, current.id),
          eq(oneTimeSchedules.revision, revision),
          eq(oneTimeSchedules.status, 'paused'),
        ),
      );

    return true;
  }

  static async executeOneTime({
    mastra,
    scheduleId,
    revision,
  }: {
    mastra: Mastra;
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
      return { status: 'already_handled' as const };
    }

    try {
      const delivery = mastra.getAgent('agent').sendSignal(
        {
          type: 'notification',
          contents: schedule.prompt,
          attributes: { source: 'one-time-schedule' },
        },
        {
          resourceId: schedule.resourceId,
          threadId: schedule.threadId,
          ifIdle: { behavior: 'wake' },
          ifActive: { behavior: 'deliver' },
        },
      );
      const accepted = await delivery.accepted;

      if (accepted.action === 'wake') {
        await accepted.output.consumeStream();
      }

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
      schedule.status !== 'active'
    ) {
      return { status: 'inactive_or_missing' as const };
    }

    const timeZone = schedule.timezone ?? 'UTC';

    if (
      respectOccurrenceCompletion &&
      (await this.prepareOccurrence({
        scheduleId: schedule.id,
        firedAt: new Date(),
        timeZone,
      })) === null
    ) {
      return { status: 'occurrence_completed_early' as const };
    }

    if (
      !(await this.#claimRecurringRun({
        deliveryId,
        scheduleId: schedule.id,
        resourceId: schedule.resourceId,
      }))
    ) {
      return { status: 'already_handled' as const };
    }

    try {
      const requestContext = new RequestContext();
      requestContext.set(MASTRA_RESOURCE_ID_KEY, schedule.resourceId);
      requestContext.set(MASTRA_THREAD_ID_KEY, schedule.threadId);
      requestContext.set('timeZone', timeZone);

      const delivery = mastra.getAgent('agent').sendSignal(
        {
          type: schedule.signalType ?? 'notification',
          contents: schedule.prompt,
          attributes: {
            ...schedule.attributes,
            source: 'recurring-schedule',
            scheduleId: schedule.id,
          },
        },
        {
          resourceId: schedule.resourceId,
          threadId: schedule.threadId,
          ifActive: schedule.ifActive ?? { behavior: 'deliver' },
          ifIdle: {
            ...schedule.ifIdle,
            behavior: schedule.ifIdle?.behavior ?? 'wake',
            streamOptions: {
              requestContext,
            },
          },
        },
      );
      const accepted = await delivery.accepted;

      if (accepted.action === 'wake') {
        await accepted.output.consumeStream();
      }

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

    return this.#receiver.verify({
      signature,
      body: await request.clone().text(),
      url: request.url,
    });
  }

  static get #qstash() {
    return new Client({ token: this.#requiredEnvironment('QSTASH_TOKEN') });
  }

  static get #receiver() {
    return new Receiver({
      currentSigningKey: this.#requiredEnvironment('QSTASH_CURRENT_SIGNING_KEY'),
      nextSigningKey: this.#requiredEnvironment('QSTASH_NEXT_SIGNING_KEY'),
    });
  }

  static get #executionUrl() {
    const baseUrl =
      process.env.AGENT_PUBLIC_URL ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL;

    if (!baseUrl) {
      throw new Error('AGENT_PUBLIC_URL or a Vercel deployment URL is required for scheduling.');
    }

    return new URL(
      '/api/jobs/schedules/execute',
      baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`,
    ).toString();
  }

  static async #publishOneTime({
    scheduleId,
    revision,
    runAt,
    title,
  }: {
    scheduleId: string;
    revision: number;
    runAt: Date;
    title: string;
  }) {
    const result = await this.#qstash.publishJSON({
      url: this.#executionUrl,
      body: { kind: 'one_time', scheduleId, revision },
      notBefore: Math.floor(runAt.getTime() / 1_000),
      retries: 3,
      deduplicationId: `agent-schedule-${scheduleId}-${revision}`,
      label: ['agent-reminder', this.#slug(title)],
    });
    const messageId = Array.isArray(result) ? undefined : result.messageId;

    if (!messageId) {
      throw new Error('QStash did not return a message id.');
    }

    return messageId;
  }

  static async #upsertRecurringTrigger({
    scheduleId,
    title,
    cron,
    timeZone,
  }: {
    scheduleId: string;
    title: string;
    cron: string;
    timeZone: string;
  }) {
    await this.#qstash.schedules.create({
      destination: this.#executionUrl,
      scheduleId: this.#recurringTriggerId(scheduleId),
      body: JSON.stringify({ kind: 'recurring', scheduleId }),
      headers: {
        'content-type': 'application/json',
      },
      cron: `CRON_TZ=${timeZone} ${cron}`,
      retries: 3,
      timeout: 60,
      label: ['agent-recurring', this.#slug(title)],
    });
  }

  static async #withRecurringTriggerState<T extends { id: string }>(schedule: T) {
    try {
      const trigger = await this.#qstash.schedules.get(this.#recurringTriggerId(schedule.id));

      return this.#recurringScheduleWithTrigger(schedule, trigger);
    } catch {
      if (
        !('cron' in schedule) ||
        typeof schedule.cron !== 'string' ||
        !('status' in schedule) ||
        (schedule.status !== 'active' && schedule.status !== 'paused')
      ) {
        return this.#recurringScheduleWithUnavailableTrigger(schedule);
      }

      try {
        await this.#upsertRecurringTrigger({
          scheduleId: schedule.id,
          title:
            'name' in schedule && typeof schedule.name === 'string'
              ? schedule.name
              : 'Recurring task',
          cron: schedule.cron,
          timeZone:
            'timezone' in schedule && typeof schedule.timezone === 'string'
              ? schedule.timezone
              : 'UTC',
        });

        if (schedule.status === 'paused') {
          await this.#qstash.schedules.pause({
            schedule: this.#recurringTriggerId(schedule.id),
          });
        }

        const trigger = await this.#qstash.schedules.get(this.#recurringTriggerId(schedule.id));

        return this.#recurringScheduleWithTrigger(schedule, trigger);
      } catch {
        return this.#recurringScheduleWithUnavailableTrigger(schedule);
      }
    }
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
      return true;
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
            eq(recurringScheduleRuns.status, 'failed'),
            and(
              eq(recurringScheduleRuns.status, 'running'),
              lt(recurringScheduleRuns.executionStartedAt, new Date(now.getTime() - RUN_LEASE_MS)),
            ),
          ),
        ),
      )
      .returning({ deliveryId: recurringScheduleRuns.deliveryId });

    return Boolean(reclaimed);
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
};

type CreateRecurringScheduleInput = {
  schedules: Mastra['schedules'];
  resourceId: string;
  threadId: string;
  title: string;
  prompt: string;
  cron: string;
  timeZone: string;
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
  deliveryId: string;
  respectOccurrenceCompletion: boolean;
};

type QStashSchedule = Awaited<ReturnType<Client['schedules']['get']>>;

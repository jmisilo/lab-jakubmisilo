import type { Mastra } from '@mastra/core/mastra';

import { Client, Receiver } from '@upstash/qstash';
import { Cron } from 'croner';
import { and, count, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { database } from '../../../infrastructure/database';
import {
  oneTimeSchedules,
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

    return input.schedules.create({
      agentId: 'agent',
      name: input.title,
      prompt: input.prompt,
      cron: input.cron,
      timezone: input.timeZone,
      threadId: input.threadId,
      resourceId: input.resourceId,
      ifIdle: { behavior: 'wake' },
      ifActive: { behavior: 'deliver' },
      metadata: { kind: 'recurring' },
    });
  }

  static async updateRecurring(input: UpdateRecurringScheduleInput) {
    const schedule = await input.schedules.get(input.scheduleId);

    if (!schedule || !('resourceId' in schedule) || schedule.resourceId !== input.resourceId) {
      return false;
    }

    if (input.cron) {
      this.#assertSupportedCron(input.cron);
    }

    await input.schedules.update(input.scheduleId, {
      name: input.title,
      prompt: input.prompt,
      cron: input.cron,
      timezone: input.timeZone,
    });

    return true;
  }

  static async changeRecurring(input: ChangeRecurringScheduleInput) {
    const schedule = await input.schedules.get(input.scheduleId);

    if (!schedule || !('resourceId' in schedule) || schedule.resourceId !== input.resourceId) {
      return false;
    }

    if (input.action === 'pause') {
      await input.schedules.pause(input.scheduleId);
    } else if (input.action === 'resume') {
      await input.schedules.resume(input.scheduleId);
    } else if (input.action === 'run_now') {
      await input.schedules.run(input.scheduleId);
    } else {
      await input.schedules.delete(input.scheduleId);
    }

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
      schedules.list({ agentId: 'agent', resourceId }),
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

    return { recurring, oneTime };
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
      '/jobs/schedules/execute',
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
      body: { scheduleId, revision },
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
  action: 'pause' | 'resume' | 'run_now' | 'cancel';
};

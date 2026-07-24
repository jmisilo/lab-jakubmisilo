import type { Mastra } from '@mastra/core/mastra';

import { Client, Receiver } from '@upstash/qstash';
import { and, count, eq, inArray } from 'drizzle-orm';

import { database } from '../../../infrastructure/database';
import { oneTimeSchedules } from '../../../infrastructure/database/schema';

const ACTIVE_ONE_TIME_LIMIT = 10;
const ACTIVE_RECURRING_LIMIT = 10;
const MAX_ONE_TIME_DELAY_MS = 7 * 24 * 60 * 60 * 1_000;

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
      const result = await this.#qstash.publishJSON({
        url: this.#executionUrl,
        body: { scheduleId: schedule.id },
        notBefore: Math.floor(runAt.getTime() / 1_000),
        retries: 3,
        deduplicationId: `agent-schedule-${schedule.id}`,
        label: ['agent-reminder', this.#slug(input.title)],
      });
      const messageId = Array.isArray(result) ? undefined : result.messageId;

      if (!messageId) {
        throw new Error('QStash did not return a message id.');
      }

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
      ifActive: { behavior: 'persist' },
      metadata: { kind: 'recurring' },
    });
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

  static async executeOneTime({ mastra, scheduleId }: { mastra: Mastra; scheduleId: string }) {
    const [schedule] = await database
      .update(oneTimeSchedules)
      .set({ status: 'running', updatedAt: new Date() })
      .where(and(eq(oneTimeSchedules.id, scheduleId), eq(oneTimeSchedules.status, 'active')))
      .returning();

    if (!schedule) {
      return { status: 'already_handled' as const };
    }

    try {
      await mastra.getAgent('agent').sendSignal(
        {
          type: 'notification',
          contents: schedule.prompt,
          attributes: { source: 'one-time-schedule' },
        },
        {
          resourceId: schedule.resourceId,
          threadId: schedule.threadId,
          ifIdle: { behavior: 'wake' },
          ifActive: { behavior: 'persist' },
        },
      );

      await database
        .update(oneTimeSchedules)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(oneTimeSchedules.id, schedule.id));

      return { status: 'completed' as const };
    } catch (error) {
      await database
        .update(oneTimeSchedules)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(oneTimeSchedules.id, schedule.id));
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

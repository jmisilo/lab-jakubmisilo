import type { Context } from 'hono';

import { Receiver, SignatureError } from '@upstash/qstash';
import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { AgentScheduleRunner } from '@/app/schedules/runner';
import {
  ScheduleExecutionPayloadSchema,
  ScheduleFailureCallbackPayloadSchema,
} from '@/app/schedules/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export const ScheduleRouter = new Hono()
  .post('/jobs/schedules/execute', async (c) => {
    const verification = await readVerifiedQStashBody(c);

    if (!verification.ok) {
      return verification.response;
    }

    logger.info({ url: c.req.url }, '[AGENT_SCHEDULE]: execution request verified');

    try {
      const parsedPayload = ScheduleExecutionPayloadSchema.safeParse(
        parseJsonBody(verification.body),
      );

      if (!parsedPayload.success) {
        logger.warn(
          { issues: parsedPayload.error.issues },
          '[AGENT_SCHEDULE]: execution request payload invalid',
        );

        return c.json({ ok: false, error: 'Invalid payload' }, 400);
      }

      const result = await AgentScheduleRunner.executeTask({
        bot,
        taskId: parsedPayload.data.taskId,
        scheduleKind: parsedPayload.data.scheduleKind,
        scheduledFor: parseOptionalDate(parsedPayload.data.scheduledFor),
      });

      return c.json({ ok: true, result });
    } catch (error) {
      logger.error(
        { error, safeError: ErrorService.toSafeLog(error), url: c.req.url },
        '[AGENT_SCHEDULE]: execution request failed',
      );

      return c.json({ ok: false, error: 'Schedule runner failed' }, 500);
    }
  })
  .post('/jobs/schedules/failure', async (c) => {
    const verification = await readVerifiedQStashBody(c);

    if (!verification.ok) {
      return verification.response;
    }

    logger.info({ url: c.req.url }, '[AGENT_SCHEDULE]: failure callback verified');

    try {
      const parsedFailure = parseFailureCallbackBody(verification.body);

      if (!parsedFailure.ok) {
        logger.warn(
          { issues: parsedFailure.issues },
          '[AGENT_SCHEDULE]: failure callback payload invalid',
        );

        return c.json({ ok: false, error: 'Invalid payload' }, 400);
      }

      const result = await AgentScheduleRunner.handleExecutionExhausted({
        taskId: parsedFailure.taskId,
        scheduleKind: parsedFailure.scheduleKind,
        scheduledFor: parsedFailure.scheduledFor,
        failure: parsedFailure.failure,
      });

      return c.json({ ok: true, result });
    } catch (error) {
      logger.error(
        { error, safeError: ErrorService.toSafeLog(error), url: c.req.url },
        '[AGENT_SCHEDULE]: failure callback handling failed',
      );

      return c.json({ ok: false, error: 'Schedule failure callback failed' }, 500);
    }
  });

async function readVerifiedQStashBody(c: Context) {
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) {
    logger.error('[AGENT_SCHEDULE]: QStash signing keys are not configured');

    return {
      ok: false as const,
      response: c.json({ ok: false, error: 'QStash signing keys are not configured' }, 500),
    };
  }

  const signature = c.req.header('upstash-signature');

  if (!signature) {
    logger.warn({ url: c.req.url }, '[AGENT_SCHEDULE]: execution request missing QStash signature');

    return {
      ok: false as const,
      response: c.json({ ok: false, error: 'Unauthorized' }, 401),
    };
  }

  const body = await c.req.text();
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    devMode: false,
  });

  try {
    const verified = await receiver.verify({
      signature,
      body,
      url: c.req.url,
      clockTolerance: 30,
      upstashRegion: c.req.header('upstash-region'),
    });

    if (!verified) {
      return {
        ok: false as const,
        response: c.json({ ok: false, error: 'Unauthorized' }, 401),
      };
    }
  } catch (error) {
    if (error instanceof SignatureError) {
      logger.warn(
        { error, safeError: ErrorService.toSafeLog(error) },
        '[AGENT_SCHEDULE]: execution request QStash signature verification failed',
      );

      return {
        ok: false as const,
        response: c.json({ ok: false, error: 'Unauthorized' }, 401),
      };
    }

    logger.error(
      { error, safeError: ErrorService.toSafeLog(error) },
      '[AGENT_SCHEDULE]: execution request QStash signature verification errored',
    );

    return {
      ok: false as const,
      response: c.json({ ok: false, error: 'Unauthorized' }, 401),
    };
  }

  return {
    ok: true as const,
    body,
  };
}

function parseFailureCallbackBody(body: string):
  | {
      ok: true;
      taskId: string;
      scheduleKind?: 'one_time' | 'recurring';
      scheduledFor?: Date;
      failure: {
        status?: number;
        retried?: number;
        maxRetries?: number;
        dlqId?: string;
        sourceMessageId?: string;
      };
    }
  | { ok: false; issues: unknown } {
  const parsedCallback = ScheduleFailureCallbackPayloadSchema.safeParse(parseJsonBody(body));

  if (!parsedCallback.success) {
    return { ok: false, issues: parsedCallback.error.issues };
  }

  const parsedSourceBody = ScheduleExecutionPayloadSchema.safeParse(
    parseJsonBody(decodeBase64Text(parsedCallback.data.sourceBody)),
  );

  if (!parsedSourceBody.success) {
    return { ok: false, issues: parsedSourceBody.error.issues };
  }

  return {
    ok: true,
    taskId: parsedSourceBody.data.taskId,
    scheduleKind: parsedSourceBody.data.scheduleKind,
    scheduledFor: parseOptionalDate(parsedSourceBody.data.scheduledFor),
    failure: {
      status: parsedCallback.data.status,
      retried: parsedCallback.data.retried,
      maxRetries: parsedCallback.data.maxRetries,
      dlqId: parsedCallback.data.dlqId,
      sourceMessageId: parsedCallback.data.sourceMessageId,
    },
  };
}

function decodeBase64Text(value: string) {
  return Buffer.from(value, 'base64').toString('utf8');
}

function parseOptionalDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseJsonBody(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

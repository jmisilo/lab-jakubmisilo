import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { AgentScheduleRunner } from '@/app/schedules/runner';
import {
  ScheduleExecutionPayloadSchema,
  ScheduleFailureCallbackPayloadSchema,
} from '@/app/schedules/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';
import { QStashService } from '@/infrastructure/qstash';

export const ScheduleRouter = new Hono()
  .post('/jobs/schedules/execute', async (c) => {
    const verification = await QStashService.verifySignedRequest(c.req.raw);

    if (!verification.ok) {
      if (verification.reason === 'missing_configuration') {
        logger.error('[AGENT_SCHEDULE]: QStash signing keys are not configured');

        return c.json({ ok: false, error: 'QStash signing keys are not configured' }, 500);
      }

      logger.warn('[AGENT_SCHEDULE]: execution request unauthorized');

      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    logger.info('[AGENT_SCHEDULE]: execution request verified');

    try {
      const parsedPayload = ScheduleExecutionPayloadSchema.safeParse(
        parseJsonBody(verification.body),
      );

      if (!parsedPayload.success) {
        logger.warn(
          { issueCount: parsedPayload.error.issues.length },
          '[AGENT_SCHEDULE]: execution request payload invalid',
        );

        return c.json({ ok: false, error: 'Invalid payload' }, 400);
      }

      const result = await AgentScheduleRunner.executeTask({
        bot,
        taskId: parsedPayload.data.taskId,
        scheduleKind: parsedPayload.data.scheduleKind,
        scheduledFor: parseOptionalDate(parsedPayload.data.scheduledFor),
        triggerVersion: parsedPayload.data.triggerVersion,
      });

      return c.json({ ok: true, result });
    } catch (error) {
      logger.error(
        { safeError: ErrorService.toSafeLog(error) },
        '[AGENT_SCHEDULE]: execution request failed',
      );

      return c.json({ ok: false, error: 'Schedule runner failed' }, 500);
    }
  })
  .post('/jobs/schedules/failure', async (c) => {
    const verification = await QStashService.verifySignedRequest(c.req.raw);

    if (!verification.ok) {
      if (verification.reason === 'missing_configuration') {
        logger.error('[AGENT_SCHEDULE]: QStash signing keys are not configured');

        return c.json({ ok: false, error: 'QStash signing keys are not configured' }, 500);
      }

      logger.warn('[AGENT_SCHEDULE]: failure callback unauthorized');

      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    logger.info('[AGENT_SCHEDULE]: failure callback verified');

    try {
      const parsedFailure = parseFailureCallbackBody(verification.body);

      if (!parsedFailure.ok) {
        logger.warn(
          { issueCount: parsedFailure.issueCount },
          '[AGENT_SCHEDULE]: failure callback payload invalid',
        );

        return c.json({ ok: false, error: 'Invalid payload' }, 400);
      }

      const result = await AgentScheduleRunner.handleExecutionExhausted({
        taskId: parsedFailure.taskId,
        scheduleKind: parsedFailure.scheduleKind,
        scheduledFor: parsedFailure.scheduledFor,
        triggerVersion: parsedFailure.triggerVersion,
        failure: parsedFailure.failure,
      });

      return c.json({ ok: true, result });
    } catch (error) {
      logger.error(
        { safeError: ErrorService.toSafeLog(error) },
        '[AGENT_SCHEDULE]: failure callback handling failed',
      );

      return c.json({ ok: false, error: 'Schedule failure callback failed' }, 500);
    }
  });

function parseFailureCallbackBody(body: string):
  | {
      ok: true;
      taskId: string;
      scheduleKind?: 'one_time' | 'recurring';
      scheduledFor?: Date;
      triggerVersion?: string;
      failure: {
        status?: number;
        retried?: number;
        maxRetries?: number;
        dlqId?: string;
        sourceMessageId?: string;
      };
    }
  | { ok: false; issueCount: number } {
  const parsedCallback = ScheduleFailureCallbackPayloadSchema.safeParse(parseJsonBody(body));

  if (!parsedCallback.success) {
    return { ok: false, issueCount: parsedCallback.error.issues.length };
  }

  const parsedSourceBody = ScheduleExecutionPayloadSchema.safeParse(
    parseJsonBody(decodeBase64Text(parsedCallback.data.sourceBody)),
  );

  if (!parsedSourceBody.success) {
    return { ok: false, issueCount: parsedSourceBody.error.issues.length };
  }

  return {
    ok: true,
    taskId: parsedSourceBody.data.taskId,
    scheduleKind: parsedSourceBody.data.scheduleKind,
    scheduledFor: parseOptionalDate(parsedSourceBody.data.scheduledFor),
    triggerVersion: parsedSourceBody.data.triggerVersion,
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

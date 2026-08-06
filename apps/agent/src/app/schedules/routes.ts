import { registerApiRoute } from '@mastra/core/server';

import type { ScheduleExecutionPayload } from './schemas';
import { SchedulingService } from '.';
import { logger } from '../../infrastructure/logger';
import { ScheduleExecutionPayloadSchema, ScheduleFailureCallbackPayloadSchema } from './schemas';

export const scheduleExecutionRoute = registerApiRoute('/api/jobs/schedules/execute', {
  method: 'POST',
  requiresAuth: false,
  handler: async (context) => {
    if (!(await SchedulingService.verifyRequest(context.req.raw))) {
      return context.json({ error: 'invalid signature' }, 401);
    }

    let body: unknown;

    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'invalid payload' }, 400);
    }

    const payload = ScheduleExecutionPayloadSchema.safeParse(body);

    if (!payload.success) {
      return context.json({ error: 'invalid payload' }, 400);
    }

    if (payload.data.kind === 'one_time') {
      try {
        const result = await SchedulingService.executeOneTime({
          scheduleId: payload.data.scheduleId,
          revision: payload.data.revision,
        });

        return result.status === 'retry_later' ? context.json(result, 503) : context.json(result);
      } catch (error) {
        _logExecutionFailure({ error, payload: payload.data });
        return context.json({ error: 'scheduled delivery failed' }, 500);
      }
    }

    const deliveryId = context.req.header('upstash-message-id');

    if (!deliveryId) {
      return context.json({ error: 'missing delivery id' }, 400);
    }

    try {
      const result = await SchedulingService.executeRecurring({
        mastra: context.get('mastra'),
        scheduleId: payload.data.scheduleId,
        triggerVersion: payload.data.triggerVersion,
        deliveryId,
        respectOccurrenceCompletion: true,
      });

      return result.status === 'retry_later' ? context.json(result, 503) : context.json(result);
    } catch (error) {
      _logExecutionFailure({ error, payload: payload.data, deliveryId });
      return context.json({ error: 'scheduled delivery failed' }, 500);
    }
  },
});

export const scheduleFailureRoute = registerApiRoute('/api/jobs/schedules/failure', {
  method: 'POST',
  requiresAuth: false,
  handler: async (context) => {
    if (!(await SchedulingService.verifyRequest(context.req.raw))) {
      return context.json({ error: 'invalid signature' }, 401);
    }

    let body: unknown;

    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'invalid failure callback payload' }, 400);
    }

    const payload = ScheduleFailureCallbackPayloadSchema.safeParse(body);

    if (!payload.success) {
      return context.json({ error: 'invalid failure callback payload' }, 400);
    }

    return context.json(
      await SchedulingService.handleFailureCallback({
        mastra: context.get('mastra'),
        payload: payload.data,
      }),
    );
  },
});

function _logExecutionFailure({
  error,
  payload,
  deliveryId,
}: {
  error: unknown;
  payload: ScheduleExecutionPayload;
  deliveryId?: string;
}) {
  logger.error('Scheduled delivery route failed', {
    deliveryId,
    error: _describeError(error),
    kind: payload.kind,
    scheduleId: payload.scheduleId,
  });
}

function _describeError(error: unknown) {
  return error instanceof Error
    ? {
        name: error.name,
        message: error.message.slice(0, 1_000),
        stack: error.stack?.slice(0, 4_000),
      }
    : { name: 'UnknownError', message: String(error).slice(0, 1_000) };
}

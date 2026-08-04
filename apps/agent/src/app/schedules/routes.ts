import { registerApiRoute } from '@mastra/core/server';

import { SchedulingService } from '.';
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
      const result = await SchedulingService.executeOneTime({
        scheduleId: payload.data.scheduleId,
        revision: payload.data.revision,
      });

      return result.status === 'retry_later' ? context.json(result, 503) : context.json(result);
    }

    const deliveryId = context.req.header('upstash-message-id');

    if (!deliveryId) {
      return context.json({ error: 'missing delivery id' }, 400);
    }

    const result = await SchedulingService.executeRecurring({
      mastra: context.get('mastra'),
      scheduleId: payload.data.scheduleId,
      triggerVersion: payload.data.triggerVersion,
      deliveryId,
      respectOccurrenceCompletion: true,
    });

    return result.status === 'retry_later' ? context.json(result, 503) : context.json(result);
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

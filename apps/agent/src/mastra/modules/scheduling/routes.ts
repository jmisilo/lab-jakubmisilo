import { registerApiRoute } from '@mastra/core/server';

import { SchedulingService } from '.';
import { ScheduleExecutionPayloadSchema } from './schemas';

export const scheduleExecutionRoute = registerApiRoute('/api/jobs/schedules/execute', {
  method: 'POST',
  requiresAuth: false,
  handler: async (context) => {
    if (!(await SchedulingService.verifyRequest(context.req.raw))) {
      return context.json({ error: 'invalid signature' }, 401);
    }

    const payload = ScheduleExecutionPayloadSchema.safeParse(await context.req.json());

    if (!payload.success) {
      return context.json({ error: 'invalid payload' }, 400);
    }

    if (payload.data.kind === 'one_time') {
      return context.json(
        await SchedulingService.executeOneTime({
          mastra: context.get('mastra'),
          scheduleId: payload.data.scheduleId,
          revision: payload.data.revision,
        }),
      );
    }

    const deliveryId = context.req.header('upstash-message-id');

    if (!deliveryId) {
      return context.json({ error: 'missing delivery id' }, 400);
    }

    return context.json(
      await SchedulingService.executeRecurring({
        mastra: context.get('mastra'),
        scheduleId: payload.data.scheduleId,
        deliveryId,
        respectOccurrenceCompletion: true,
      }),
    );
  },
});

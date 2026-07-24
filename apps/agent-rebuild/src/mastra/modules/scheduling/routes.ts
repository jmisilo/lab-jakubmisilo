import { registerApiRoute } from '@mastra/core/server';

import { SchedulingService } from '.';
import { OneTimeSchedulePayloadSchema } from './schemas';

export const scheduleExecutionRoute = registerApiRoute('/jobs/schedules/execute', {
  method: 'POST',
  requiresAuth: false,
  handler: async (context) => {
    if (!(await SchedulingService.verifyRequest(context.req.raw))) {
      return context.json({ error: 'invalid signature' }, 401);
    }

    const payload = OneTimeSchedulePayloadSchema.safeParse(await context.req.json());

    if (!payload.success) {
      return context.json({ error: 'invalid payload' }, 400);
    }

    return context.json(
      await SchedulingService.executeOneTime({
        mastra: context.get('mastra'),
        scheduleId: payload.data.scheduleId,
        revision: payload.data.revision,
      }),
    );
  },
});

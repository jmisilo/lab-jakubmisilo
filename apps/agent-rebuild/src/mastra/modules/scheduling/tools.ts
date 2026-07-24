import { createTool } from '@mastra/core/tools';

import { SchedulingService } from '.';
import { ManageScheduleInputSchema, ManageScheduleRequestSchema } from './schemas';

export const manageScheduleTool = createTool({
  id: 'manage_schedule',
  description:
    'Create, list, pause, resume, run, or cancel one-time reminders and recurring agent tasks. Resolve dates and times before creating a task. A successful result is required before confirming it to the user.',
  inputSchema: ManageScheduleInputSchema,
  execute: async (input, { agent, mastra }) => {
    if (!agent?.resourceId || !agent.threadId || !mastra) {
      return { ok: false, message: 'Scheduling requires an active conversation.' };
    }

    try {
      const request = ManageScheduleRequestSchema.parse(input);

      if (request.action === 'create_one_time') {
        return {
          ok: true,
          schedule: await SchedulingService.createOneTime({
            resourceId: agent.resourceId,
            threadId: agent.threadId,
            title: request.title,
            prompt: request.prompt,
            runAt: request.runAt,
          }),
        };
      }

      if (request.action === 'create_recurring') {
        return {
          ok: true,
          schedule: await SchedulingService.createRecurring({
            schedules: mastra.schedules,
            resourceId: agent.resourceId,
            threadId: agent.threadId,
            title: request.title,
            prompt: request.prompt,
            cron: request.cron,
            timeZone: request.timeZone,
          }),
        };
      }

      if (request.action === 'list') {
        return {
          ok: true,
          schedules: await SchedulingService.list({
            schedules: mastra.schedules,
            resourceId: agent.resourceId,
            includeInactive: request.includeInactive,
          }),
        };
      }

      if (request.action === 'pause') {
        return { ok: true, schedule: await mastra.schedules.pause(request.scheduleId) };
      }

      if (request.action === 'resume') {
        return { ok: true, schedule: await mastra.schedules.resume(request.scheduleId) };
      }

      if (request.action === 'run_now') {
        return { ok: true, schedule: await mastra.schedules.run(request.scheduleId) };
      }

      if (
        await SchedulingService.cancelOneTime({
          resourceId: agent.resourceId,
          scheduleId: request.scheduleId,
        })
      ) {
        return { ok: true };
      }

      await mastra.schedules.delete(request.scheduleId);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The schedule could not be changed.',
      };
    }
  },
});

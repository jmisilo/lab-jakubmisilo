import { createTool } from '@mastra/core/tools';

import { SchedulingService } from '.';
import { ManageScheduleInputSchema, ManageScheduleRequestSchema } from './schemas';

export const manageScheduleTool = createTool({
  id: 'manage_schedule',
  description:
    'Create, list, update, complete a pending occurrence, pause, resume, run, or cancel reminders and recurring tasks. Use complete_occurrence only after explicit completion language and an exact schedule match; it suppresses only today for recurring tasks. Resolve dates before creating. Confirm actions only when ok=true.',
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
        const changed =
          (await SchedulingService.pauseOneTime({
            resourceId: agent.resourceId,
            scheduleId: request.scheduleId,
          })) ||
          (await SchedulingService.changeRecurring({
            schedules: mastra.schedules,
            resourceId: agent.resourceId,
            scheduleId: request.scheduleId,
            action: 'pause',
          }));

        return changed
          ? { ok: true }
          : { ok: false, message: 'That active schedule could not be found.' };
      }

      if (request.action === 'resume') {
        const changed =
          (await SchedulingService.resumeOneTime({
            resourceId: agent.resourceId,
            scheduleId: request.scheduleId,
          })) ||
          (await SchedulingService.changeRecurring({
            schedules: mastra.schedules,
            resourceId: agent.resourceId,
            scheduleId: request.scheduleId,
            action: 'resume',
          }));

        return changed
          ? { ok: true }
          : { ok: false, message: 'That paused schedule could not be found.' };
      }

      if (request.action === 'run_now') {
        const changed = await SchedulingService.changeRecurring({
          schedules: mastra.schedules,
          resourceId: agent.resourceId,
          scheduleId: request.scheduleId,
          action: 'run_now',
        });

        return changed
          ? { ok: true }
          : { ok: false, message: 'That recurring schedule could not be found.' };
      }

      if (request.action === 'complete_occurrence') {
        const completion = await SchedulingService.completeOccurrence({
          schedules: mastra.schedules,
          resourceId: agent.resourceId,
          scheduleId: request.scheduleId,
        });

        return completion
          ? { ok: true, completion }
          : { ok: false, message: 'That pending schedule occurrence could not be found.' };
      }

      if (request.action === 'update') {
        const changed =
          (await SchedulingService.updateOneTime({
            resourceId: agent.resourceId,
            scheduleId: request.scheduleId,
            title: request.title,
            prompt: request.prompt,
            runAt: request.runAt,
          })) ||
          (await SchedulingService.updateRecurring({
            schedules: mastra.schedules,
            resourceId: agent.resourceId,
            scheduleId: request.scheduleId,
            title: request.title,
            prompt: request.prompt,
            cron: request.cron,
            timeZone: request.timeZone,
          }));

        return changed ? { ok: true } : { ok: false, message: 'That schedule could not be found.' };
      }

      if (
        await SchedulingService.cancelOneTime({
          resourceId: agent.resourceId,
          scheduleId: request.scheduleId,
        })
      ) {
        return { ok: true };
      }

      const changed = await SchedulingService.changeRecurring({
        schedules: mastra.schedules,
        resourceId: agent.resourceId,
        scheduleId: request.scheduleId,
        action: 'cancel',
      });

      return changed ? { ok: true } : { ok: false, message: 'That schedule could not be found.' };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'The schedule could not be changed.',
      };
    }
  },
});

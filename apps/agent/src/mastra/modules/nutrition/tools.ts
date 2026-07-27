import { createTool } from '@mastra/core/tools';

import { NutritionService } from '.';
import { resolveTimeZone } from '../../runtime-context';
import {
  ManageNutritionInputSchema,
  ManageNutritionRequestSchema,
  ReadNutritionInputSchema,
} from './schemas';

export const readNutritionTool = createTool({
  id: 'read_nutrition',
  description:
    'Read authoritative calorie and macro goals, confirmed daily totals, meals, or the current pending meal estimate. Database totals are authoritative; only confirmed meals count.',
  inputSchema: ReadNutritionInputSchema,
  execute: async ({ action, localDate }, { agent, requestContext }) => {
    if (!agent?.resourceId || !agent.threadId) {
      return { ok: false, message: 'Nutrition tracking requires an active conversation.' };
    }

    try {
      if (action === 'pending') {
        return {
          ok: true,
          meal: await NutritionService.getPending({
            resourceId: agent.resourceId,
            threadId: agent.threadId,
          }),
        };
      }

      return {
        ok: true,
        status: await NutritionService.getStatus({
          resourceId: agent.resourceId,
          timeZone: resolveTimeZone(requestContext),
          localDate,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Nutrition data could not be read.',
      };
    }
  },
});

export const manageNutritionTool = createTool({
  id: 'manage_nutrition',
  description:
    'Set calorie/macro goals and manage meal estimates. A photo or description creates a draft only. Show the approximate estimate and ask for confirmation before logging it. Never confirm without an explicit yes referring to the pending draft.',
  inputSchema: ManageNutritionInputSchema,
  execute: async (input, { agent, requestContext }) => {
    if (!agent?.resourceId || !agent.threadId) {
      return { ok: false, message: 'Nutrition tracking requires an active conversation.' };
    }

    try {
      const request = ManageNutritionRequestSchema.parse(input);
      const owner = {
        resourceId: agent.resourceId,
        threadId: agent.threadId,
      };
      const timeZone = resolveTimeZone(requestContext);

      if (request.action === 'set_goals') {
        return {
          ok: true,
          profile: await NutritionService.setGoals({
            resourceId: agent.resourceId,
            goals: request.goals,
          }),
        };
      }

      if (request.action === 'propose_meal') {
        return {
          ok: true,
          logged: false,
          meal: await NutritionService.proposeMeal({
            ...owner,
            timeZone,
            estimate: request.estimate,
          }),
        };
      }

      if (request.action === 'confirm') {
        return {
          ok: true,
          logged: true,
          ...(await NutritionService.confirmDraft({ ...owner, timeZone })),
        };
      }

      if (request.action === 'correct') {
        return {
          ok: true,
          meal: await NutritionService.correctMeal({
            ...owner,
            timeZone,
            mealId: request.mealId,
            estimate: request.estimate,
          }),
        };
      }

      return {
        ok: true,
        meal: await NutritionService.deleteMeal({
          resourceId: agent.resourceId,
          mealId: request.mealId,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Nutrition data could not be changed.',
      };
    }
  },
});

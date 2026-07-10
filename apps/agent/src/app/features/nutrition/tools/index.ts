import type { AgentNutritionMeal, AgentNutritionProfile } from '@/types';
import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import { AgentNutritionService } from '@/app/features/nutrition';
import {
  ManageNutritionToolInputSchema,
  NutritionToolContextSchema,
  NutritionToolOutputSchema,
  ReadNutritionToolInputSchema,
} from '@/app/features/nutrition/schemas';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export const readNutritionTool: ReadNutritionTool = tool({
  description: dedent`
    Read authoritative calorie and macronutrient tracking data for the current user.

    # Use For
    - Today's confirmed meals, calories, protein, carbohydrates, fat, fiber, and remaining goals.
    - A selected past local date.
    - Inspecting the current unconfirmed meal draft before correction or confirmation.

    # Rules
    - Treat database results as authoritative. Do not reconstruct totals from conversation memory.
    - Only confirmed meals contribute to daily totals.
    - Internal meal ids may be used in later tool calls but must never be shown to the user.
  `,
  inputSchema: ReadNutritionToolInputSchema,
  outputSchema: NutritionToolOutputSchema,
  contextSchema: NutritionToolContextSchema,
  execute: async (input, { context }) => {
    try {
      if (input.action === 'get_pending_draft') {
        const threadId = requireThreadId(context.threadId);
        const meal = await AgentNutritionService.getPendingDraft({
          identityId: context.identityId,
          threadId,
        });

        return {
          ok: true,
          message: meal ? 'Pending meal estimate loaded.' : 'No pending meal estimate.',
          meal: meal ? toToolMeal(meal) : undefined,
        };
      }

      const status = await AgentNutritionService.getStatus({
        identityId: context.identityId,
        timeZone: context.timeZone,
        localDate: input.localDate,
      });

      return {
        ok: true,
        message: `Nutrition status loaded for ${status.localDate}.`,
        status: toToolStatus(status),
      };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          action: input.action,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[NUTRITION]: read tool failed',
      );

      return toToolFailure(error, 'I could not load your nutrition data right now.');
    }
  },
});

export const manageNutritionTool: ManageNutritionTool = tool({
  description: dedent`
    Manage calorie and macronutrient goals and meal records for the current user.

    # Actions
    - set_goals: create or update calorie, protein, carbohydrate, fat, or fiber goals.
    - propose_meal: store a structured photo/text estimate as a draft. This does not log the meal.
    - confirm_draft: log the current draft after explicit user confirmation.
    - correct_meal: replace a pending or selected meal estimate with corrected structured values.
    - delete_meal: remove a selected meal from tracking.

    # Confirmation Safety
    - Never call confirm_draft merely because a photo or food description was sent.
    - After propose_meal, show the estimate and ask whether to log it.
    - Confirm only after a clear response such as "yes", "log it", or "looks right" that refers to the pending draft.
    - Corrections before confirmation update the draft. Corrections to logged meals update daily totals automatically.

    # Estimation
    - For photos, identify visible food, estimate portions in grams, preparation, calories, macros, confidence, and a realistic calorie range.
    - Hidden oils, sauces, fillings, and unclear portions increase uncertainty. Ask a short question when the result would materially change.
    - Estimates are approximate, not measurements or medical advice.
    - Internal meal ids may be used in tool calls but must never be shown to the user.
  `,
  inputSchema: ManageNutritionToolInputSchema,
  outputSchema: NutritionToolOutputSchema,
  contextSchema: NutritionToolContextSchema,
  execute: async (input, { context }) => {
    try {
      if (input.action === 'set_goals') {
        const profile = await AgentNutritionService.setGoals({
          identityId: context.identityId,
          goals: input.goals,
          sourceMessageId: context.sourceMessageId,
        });

        return {
          ok: true,
          message: 'Nutrition goals updated.',
          profile: toToolProfile(profile),
        };
      }

      const threadId = requireThreadId(context.threadId);

      if (input.action === 'propose_meal') {
        const result = await AgentNutritionService.createMealDraft({
          identityId: context.identityId,
          threadId,
          timeZone: context.timeZone,
          sourceMessageId: context.sourceMessageId,
          estimate: input.estimate,
        });

        return {
          ok: true,
          message: 'Meal estimate saved as a draft. It is not logged until the user confirms it.',
          meal: toToolMeal(result.meal),
        };
      }

      if (input.action === 'confirm_draft') {
        const result = await AgentNutritionService.confirmPendingDraft({
          identityId: context.identityId,
          threadId,
          timeZone: context.timeZone,
        });

        return {
          ok: true,
          message: 'Meal logged.',
          meal: toToolMeal(result.meal),
          status: toToolStatus(result.status),
        };
      }

      if (input.action === 'correct_meal') {
        const meal = await AgentNutritionService.correctMeal({
          identityId: context.identityId,
          threadId,
          mealId: input.mealId,
          estimate: input.estimate,
          timeZone: context.timeZone,
        });

        return { ok: true, message: 'Meal estimate updated.', meal: toToolMeal(meal) };
      }

      const meal = await AgentNutritionService.deleteMeal({
        identityId: context.identityId,
        mealId: input.mealId,
      });

      return { ok: true, message: 'Meal removed.', meal: toToolMeal(meal) };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          action: input.action,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[NUTRITION]: manage tool failed',
      );

      return toToolFailure(error, 'I could not update your nutrition data right now.');
    }
  },
});

function requireThreadId(threadId?: string) {
  if (threadId) {
    return threadId;
  }

  throw new AppError({
    code: AppErrorCode.NUTRITION_INPUT_INVALID,
    message: 'Nutrition meal operations require a chat thread.',
    retryable: false,
    userMessage: 'Meal tracking requires an active conversation.',
  });
}

function toToolFailure(error: unknown, fallbackMessage: string) {
  const failure = ErrorService.toUserFacingFailure(error, {
    fallbackCode: AppErrorCode.NUTRITION_PERSISTENCE_FAILED,
    fallbackMessage,
  });

  return { ok: false as const, message: failure.message };
}

function toToolProfile(profile: AgentNutritionProfile) {
  return {
    dailyCaloriesGoal: profile.dailyCaloriesGoal,
    dailyProteinGoalGrams: profile.dailyProteinGoalGrams,
    dailyCarbsGoalGrams: profile.dailyCarbsGoalGrams,
    dailyFatGoalGrams: profile.dailyFatGoalGrams,
    dailyFiberGoalGrams: profile.dailyFiberGoalGrams,
  };
}

function toToolMeal(meal: AgentNutritionMeal) {
  return {
    id: meal.id,
    status: meal.status,
    name: meal.name,
    items: meal.items,
    source: meal.source,
    calories: meal.calories,
    caloriesMin: meal.caloriesMin,
    caloriesMax: meal.caloriesMax,
    proteinGrams: meal.proteinGrams,
    carbsGrams: meal.carbsGrams,
    fatGrams: meal.fatGrams,
    fiberGrams: meal.fiberGrams,
    confidence: meal.confidence,
    localDate: meal.localDate,
    eatenAt: meal.eatenAt.toISOString(),
  };
}

function toToolStatus(status: NutritionStatus) {
  return {
    localDate: status.localDate,
    profile: status.profile ? toToolProfile(status.profile) : null,
    totals: status.totals,
    remaining: status.remaining,
    meals: status.meals.map(toToolMeal),
  };
}

export type ReadNutritionTool = Tool<
  z.infer<typeof ReadNutritionToolInputSchema>,
  z.infer<typeof NutritionToolOutputSchema>,
  z.infer<typeof NutritionToolContextSchema>
>;

export type ManageNutritionTool = Tool<
  z.infer<typeof ManageNutritionToolInputSchema>,
  z.infer<typeof NutritionToolOutputSchema>,
  z.infer<typeof NutritionToolContextSchema>
>;

type NutritionStatus = Awaited<ReturnType<typeof AgentNutritionService.getStatus>>;

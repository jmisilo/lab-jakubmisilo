import type {
  ConfirmNutritionDraftInput,
  CorrectNutritionMealInput,
  CreateNutritionDraftInput,
  DeleteNutritionMealInput,
  GetNutritionStatusInput,
  NutritionConfidence,
  NutritionMealEstimate,
  NutritionMealItem,
  SetNutritionGoalsInput,
} from '@/app/features/nutrition/types';

import { randomUUID } from 'node:crypto';

import { AgentNutritionDbService } from '@/infrastructure/db/services/agent-nutrition';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

const CALORIE_RANGE_RATIO: Record<NutritionConfidence, number> = {
  high: 0.1,
  medium: 0.2,
  low: 0.3,
};

export class AgentNutritionService {
  static async setGoals({ identityId, goals, sourceMessageId }: SetNutritionGoalsInput) {
    const current = await AgentNutritionDbService.getProfile({ identityId });
    const dailyCaloriesGoal = goals.dailyCaloriesGoal ?? current?.dailyCaloriesGoal;

    if (dailyCaloriesGoal === undefined) {
      throw new AppError({
        code: AppErrorCode.NUTRITION_GOAL_REQUIRED,
        message: 'Initial nutrition profile requires a daily calorie goal.',
        context: { identityId },
        retryable: false,
        userMessage: 'Tell me your daily calorie goal first.',
      });
    }

    const profile = await AgentNutritionDbService.upsertProfile({
      identityId,
      dailyCaloriesGoal,
      dailyProteinGoalGrams:
        goals.dailyProteinGoalGrams !== undefined
          ? goals.dailyProteinGoalGrams
          : (current?.dailyProteinGoalGrams ?? null),
      dailyCarbsGoalGrams:
        goals.dailyCarbsGoalGrams !== undefined
          ? goals.dailyCarbsGoalGrams
          : (current?.dailyCarbsGoalGrams ?? null),
      dailyFatGoalGrams:
        goals.dailyFatGoalGrams !== undefined
          ? goals.dailyFatGoalGrams
          : (current?.dailyFatGoalGrams ?? null),
      dailyFiberGoalGrams:
        goals.dailyFiberGoalGrams !== undefined
          ? goals.dailyFiberGoalGrams
          : (current?.dailyFiberGoalGrams ?? null),
      sourceMessageId,
    });

    if (!profile) {
      throw this.#persistenceError('Nutrition goals could not be stored.', { identityId });
    }

    return profile;
  }

  static async createMealDraft({
    identityId,
    threadId,
    estimate,
    timeZone,
    sourceMessageId,
    now = new Date(),
  }: CreateNutritionDraftInput) {
    const mealValues = this.#buildMealValues({ estimate, timeZone, now });
    const result = await AgentNutritionDbService.createDraft({
      identityId,
      threadId,
      status: 'draft',
      ...mealValues,
      idempotencyKey: sourceMessageId
        ? `${sourceMessageId}:nutrition-draft`
        : `nutrition-draft:${randomUUID()}`,
      sourceMessageId,
    });

    const meal = result.meal;

    if (!meal) {
      throw this.#persistenceError('Nutrition meal draft could not be stored.', {
        identityId,
        threadId,
      });
    }

    return { meal, created: result.created };
  }

  static async getStatus({
    identityId,
    timeZone,
    localDate,
    now = new Date(),
  }: GetNutritionStatusInput) {
    const resolvedDate = localDate ?? this.#getLocalDate({ date: now, timeZone });
    const [profile, totals, meals] = await Promise.all([
      AgentNutritionDbService.getProfile({ identityId }),
      AgentNutritionDbService.getConfirmedTotalsForDate({ identityId, localDate: resolvedDate }),
      AgentNutritionDbService.listConfirmedMealsForDate({ identityId, localDate: resolvedDate }),
    ]);

    return {
      localDate: resolvedDate,
      profile,
      totals,
      remaining: profile
        ? {
            calories: profile.dailyCaloriesGoal - totals.calories,
            proteinGrams: this.#remaining(profile.dailyProteinGoalGrams, totals.proteinGrams),
            carbsGrams: this.#remaining(profile.dailyCarbsGoalGrams, totals.carbsGrams),
            fatGrams: this.#remaining(profile.dailyFatGoalGrams, totals.fatGrams),
            fiberGrams: this.#remaining(profile.dailyFiberGoalGrams, totals.fiberGrams),
          }
        : null,
      meals,
    };
  }

  static async getPendingDraft(input: { identityId: string; threadId: string }) {
    return AgentNutritionDbService.getPendingDraft(input);
  }

  static async confirmPendingDraft({
    identityId,
    threadId,
    timeZone,
    now = new Date(),
  }: ConfirmNutritionDraftInput) {
    const meal = await AgentNutritionDbService.confirmPendingDraft({
      identityId,
      threadId,
      confirmedAt: now,
    });

    if (!meal) {
      throw new AppError({
        code: AppErrorCode.NUTRITION_DRAFT_NOT_FOUND,
        message: 'No pending nutrition meal draft was found.',
        context: { identityId, threadId },
        retryable: false,
        userMessage: 'There is no pending meal estimate to log.',
      });
    }

    const status = await this.getStatus({ identityId, timeZone, localDate: meal.localDate, now });

    return { meal, status };
  }

  static async correctMeal({
    identityId,
    threadId,
    mealId,
    estimate,
    timeZone,
    now = new Date(),
  }: CorrectNutritionMealInput) {
    const current = mealId
      ? await AgentNutritionDbService.getMeal({ identityId, mealId })
      : await AgentNutritionDbService.getPendingDraft({ identityId, threadId });

    if (!current) {
      throw new AppError({
        code: mealId
          ? AppErrorCode.NUTRITION_MEAL_NOT_FOUND
          : AppErrorCode.NUTRITION_DRAFT_NOT_FOUND,
        message: 'Nutrition meal could not be found for correction.',
        context: { identityId, threadId, mealId },
        retryable: false,
        userMessage: mealId
          ? 'I could not find that meal.'
          : 'There is no pending meal estimate to correct.',
      });
    }

    const mealValues = this.#buildMealValues({ estimate, timeZone, now });
    const update = estimate.eatenAt
      ? mealValues
      : {
          ...mealValues,
          eatenAt: current.eatenAt,
          localDate: current.localDate,
        };
    const meal = await AgentNutritionDbService.updateMeal({
      identityId,
      mealId: current.id,
      update,
    });

    if (!meal) {
      throw this.#persistenceError('Nutrition meal correction could not be stored.', {
        identityId,
        mealId: current.id,
      });
    }

    return meal;
  }

  static async deleteMeal({ identityId, mealId, now = new Date() }: DeleteNutritionMealInput) {
    const meal = await AgentNutritionDbService.deleteMeal({
      identityId,
      mealId,
      deletedAt: now,
    });

    if (!meal) {
      throw new AppError({
        code: AppErrorCode.NUTRITION_MEAL_NOT_FOUND,
        message: 'Nutrition meal could not be found for deletion.',
        context: { identityId, mealId },
        retryable: false,
        userMessage: 'I could not find that meal.',
      });
    }

    return meal;
  }

  static #buildMealValues({
    estimate,
    timeZone,
    now,
  }: {
    estimate: NutritionMealEstimate;
    timeZone: string;
    now: Date;
  }) {
    const totals = this.#aggregateItems(estimate.items);
    const range = this.#resolveCalorieRange({ estimate, calories: totals.calories });
    const eatenAt = estimate.eatenAt ? new Date(estimate.eatenAt) : now;

    if (Number.isNaN(eatenAt.getTime())) {
      throw new AppError({
        code: AppErrorCode.NUTRITION_INPUT_INVALID,
        message: 'Meal timestamp is invalid.',
        context: { eatenAt: estimate.eatenAt },
        retryable: false,
        userMessage: 'I could not resolve when that meal was eaten.',
      });
    }

    return {
      name: estimate.name,
      items: estimate.items,
      source: estimate.source,
      ...totals,
      ...range,
      confidence: estimate.confidence,
      localDate: this.#getLocalDate({ date: eatenAt, timeZone }),
      eatenAt,
    };
  }

  static #aggregateItems(items: NutritionMealItem[]) {
    return {
      calories: Math.round(items.reduce((total, item) => total + item.calories, 0)),
      proteinGrams: this.#round1(items.reduce((total, item) => total + item.proteinGrams, 0)),
      carbsGrams: this.#round1(items.reduce((total, item) => total + item.carbsGrams, 0)),
      fatGrams: this.#round1(items.reduce((total, item) => total + item.fatGrams, 0)),
      fiberGrams: this.#round1(items.reduce((total, item) => total + item.fiberGrams, 0)),
    };
  }

  static #resolveCalorieRange({
    estimate,
    calories,
  }: {
    estimate: NutritionMealEstimate;
    calories: number;
  }) {
    const ratio = CALORIE_RANGE_RATIO[estimate.confidence];
    const caloriesMin = estimate.caloriesMin ?? Math.max(0, Math.round(calories * (1 - ratio)));
    const caloriesMax = estimate.caloriesMax ?? Math.round(calories * (1 + ratio));

    if (caloriesMin > calories || caloriesMax < calories) {
      throw new AppError({
        code: AppErrorCode.NUTRITION_INPUT_INVALID,
        message: 'Estimated calorie range does not include the item-derived total.',
        context: { calories, caloriesMin, caloriesMax },
        retryable: false,
        userMessage: 'That meal estimate has an inconsistent calorie range.',
      });
    }

    return { caloriesMin, caloriesMax };
  }

  static #getLocalDate({ date, timeZone }: { date: Date; timeZone: string }) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;

      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch (error) {
      throw new AppError({
        code: AppErrorCode.NUTRITION_INPUT_INVALID,
        message: 'Nutrition timezone is invalid.',
        cause: error,
        context: { timeZone },
        retryable: false,
        userMessage: 'I could not resolve your timezone for calorie tracking.',
      });
    }

    throw new AppError({
      code: AppErrorCode.NUTRITION_INPUT_INVALID,
      message: 'Nutrition local date could not be resolved.',
      context: { timeZone, date: date.toISOString() },
      retryable: false,
      userMessage: 'I could not resolve the date for that meal.',
    });
  }

  static #remaining(goal: number | null, consumed: number) {
    return goal === null ? null : this.#round1(goal - consumed);
  }

  static #round1(value: number) {
    return Math.round(value * 10) / 10;
  }

  static #persistenceError(message: string, context: Record<string, unknown>) {
    return new AppError({
      code: AppErrorCode.NUTRITION_PERSISTENCE_FAILED,
      message,
      context,
      retryable: true,
      userMessage: 'I could not save that nutrition update right now.',
    });
  }
}

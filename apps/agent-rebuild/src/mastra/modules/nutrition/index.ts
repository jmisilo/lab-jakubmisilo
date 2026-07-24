import type { z } from 'zod';

import { and, eq } from 'drizzle-orm';

import { database } from '../../../infrastructure/database';
import { nutritionMeals, nutritionProfiles } from '../../../infrastructure/database/schema';
import { NutritionGoalsSchema, NutritionMealEstimateSchema } from './schemas';

const CALORIE_RANGE_RATIO = {
  high: 0.1,
  medium: 0.2,
  low: 0.3,
} as const;

export class NutritionService {
  static async setGoals({ resourceId, goals }: { resourceId: string; goals: NutritionGoals }) {
    const [current] = await database
      .select()
      .from(nutritionProfiles)
      .where(eq(nutritionProfiles.resourceId, resourceId))
      .limit(1);
    const dailyCaloriesGoal = goals.dailyCaloriesGoal ?? current?.dailyCaloriesGoal;

    if (dailyCaloriesGoal === undefined) {
      throw new Error('Tell me your daily calorie goal first.');
    }

    const values = {
      resourceId,
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
      updatedAt: new Date(),
    };
    const [profile] = await database
      .insert(nutritionProfiles)
      .values(values)
      .onConflictDoUpdate({
        target: nutritionProfiles.resourceId,
        set: values,
      })
      .returning();

    return profile;
  }

  static async proposeMeal(input: MealMutationInput) {
    const values = this.#mealValues(input);
    const [existing] = await database
      .select()
      .from(nutritionMeals)
      .where(
        and(
          eq(nutritionMeals.resourceId, input.resourceId),
          eq(nutritionMeals.threadId, input.threadId),
          eq(nutritionMeals.status, 'draft'),
        ),
      )
      .limit(1);

    if (existing) {
      const [meal] = await database
        .update(nutritionMeals)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(nutritionMeals.id, existing.id))
        .returning();

      return meal;
    }

    const [meal] = await database
      .insert(nutritionMeals)
      .values({
        resourceId: input.resourceId,
        threadId: input.threadId,
        status: 'draft',
        ...values,
      })
      .returning();

    return meal;
  }

  static async confirmDraft({
    resourceId,
    threadId,
    timeZone,
  }: NutritionOwnerInput & { timeZone: string }) {
    const [meal] = await database
      .update(nutritionMeals)
      .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(nutritionMeals.resourceId, resourceId),
          eq(nutritionMeals.threadId, threadId),
          eq(nutritionMeals.status, 'draft'),
        ),
      )
      .returning();

    if (!meal) {
      throw new Error('There is no pending meal estimate to log.');
    }

    return {
      meal,
      status: await this.getStatus({
        resourceId,
        timeZone,
        localDate: meal.localDate,
      }),
    };
  }

  static async correctMeal(input: MealMutationInput & { mealId?: string }) {
    const [meal] = await database
      .select()
      .from(nutritionMeals)
      .where(
        input.mealId
          ? and(
              eq(nutritionMeals.id, input.mealId),
              eq(nutritionMeals.resourceId, input.resourceId),
            )
          : and(
              eq(nutritionMeals.resourceId, input.resourceId),
              eq(nutritionMeals.threadId, input.threadId),
              eq(nutritionMeals.status, 'draft'),
            ),
      )
      .limit(1);

    if (!meal || meal.status === 'deleted') {
      throw new Error('I could not find that meal.');
    }

    const values = this.#mealValues(input);
    const [updated] = await database
      .update(nutritionMeals)
      .set({
        ...values,
        eatenAt: input.estimate.eatenAt ? values.eatenAt : meal.eatenAt,
        localDate: input.estimate.eatenAt ? values.localDate : meal.localDate,
        updatedAt: new Date(),
      })
      .where(eq(nutritionMeals.id, meal.id))
      .returning();

    return updated;
  }

  static async deleteMeal({ resourceId, mealId }: { resourceId: string; mealId: string }) {
    const [meal] = await database
      .update(nutritionMeals)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(nutritionMeals.id, mealId), eq(nutritionMeals.resourceId, resourceId)))
      .returning();

    if (!meal) {
      throw new Error('I could not find that meal.');
    }

    return meal;
  }

  static async getPending({ resourceId, threadId }: NutritionOwnerInput) {
    const [meal] = await database
      .select()
      .from(nutritionMeals)
      .where(
        and(
          eq(nutritionMeals.resourceId, resourceId),
          eq(nutritionMeals.threadId, threadId),
          eq(nutritionMeals.status, 'draft'),
        ),
      )
      .limit(1);

    return meal;
  }

  static async getStatus({
    resourceId,
    timeZone,
    localDate = this.#localDate(new Date(), timeZone),
  }: {
    resourceId: string;
    timeZone: string;
    localDate?: string;
  }) {
    const [profiles, meals] = await Promise.all([
      database
        .select()
        .from(nutritionProfiles)
        .where(eq(nutritionProfiles.resourceId, resourceId))
        .limit(1),
      database
        .select()
        .from(nutritionMeals)
        .where(
          and(
            eq(nutritionMeals.resourceId, resourceId),
            eq(nutritionMeals.localDate, localDate),
            eq(nutritionMeals.status, 'confirmed'),
          ),
        ),
    ]);
    const profile = profiles[0] ?? null;
    const totals = {
      calories: meals.reduce((total, meal) => total + meal.calories, 0),
      proteinGrams: this.#round(meals.reduce((total, meal) => total + meal.proteinGrams, 0)),
      carbsGrams: this.#round(meals.reduce((total, meal) => total + meal.carbsGrams, 0)),
      fatGrams: this.#round(meals.reduce((total, meal) => total + meal.fatGrams, 0)),
      fiberGrams: this.#round(meals.reduce((total, meal) => total + meal.fiberGrams, 0)),
    };

    return {
      localDate,
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

  static #mealValues(input: MealMutationInput) {
    const totals = {
      calories: Math.round(input.estimate.items.reduce((sum, item) => sum + item.calories, 0)),
      proteinGrams: this.#round(
        input.estimate.items.reduce((sum, item) => sum + item.proteinGrams, 0),
      ),
      carbsGrams: this.#round(input.estimate.items.reduce((sum, item) => sum + item.carbsGrams, 0)),
      fatGrams: this.#round(input.estimate.items.reduce((sum, item) => sum + item.fatGrams, 0)),
      fiberGrams: this.#round(input.estimate.items.reduce((sum, item) => sum + item.fiberGrams, 0)),
    };
    const eatenAt = input.estimate.eatenAt ? new Date(input.estimate.eatenAt) : new Date();
    const ratio = CALORIE_RANGE_RATIO[input.estimate.confidence];

    return {
      name: input.estimate.name,
      items: input.estimate.items.map((item) => ({ ...item })),
      source: input.estimate.source,
      ...totals,
      caloriesMin:
        input.estimate.caloriesMin ?? Math.max(0, Math.round(totals.calories * (1 - ratio))),
      caloriesMax: input.estimate.caloriesMax ?? Math.round(totals.calories * (1 + ratio)),
      confidence: input.estimate.confidence,
      eatenAt,
      localDate: this.#localDate(eatenAt, input.timeZone),
    };
  }

  static #localDate(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
  }

  static #remaining(goal: number | null, consumed: number) {
    return goal === null ? null : this.#round(goal - consumed);
  }

  static #round(value: number) {
    return Math.round(value * 10) / 10;
  }
}

type NutritionGoals = z.infer<typeof NutritionGoalsSchema>;
type NutritionMealEstimate = z.infer<typeof NutritionMealEstimateSchema>;

type NutritionOwnerInput = {
  resourceId: string;
  threadId: string;
};

type MealMutationInput = NutritionOwnerInput & {
  timeZone: string;
  estimate: NutritionMealEstimate;
};

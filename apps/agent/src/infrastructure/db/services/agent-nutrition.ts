import type { AgentNutritionMeal, NewAgentNutritionMeal, NewAgentNutritionProfile } from '@/types';

import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { agentNutritionMeals, agentNutritionProfiles } from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

export class AgentNutritionDbService extends DbService {
  static async upsertProfile(input: NewAgentNutritionProfile) {
    const [profile] = await this.client
      .insert(agentNutritionProfiles)
      .values(input)
      .onConflictDoUpdate({
        target: agentNutritionProfiles.identityId,
        set: {
          dailyCaloriesGoal: input.dailyCaloriesGoal,
          dailyProteinGoalGrams: input.dailyProteinGoalGrams,
          dailyCarbsGoalGrams: input.dailyCarbsGoalGrams,
          dailyFatGoalGrams: input.dailyFatGoalGrams,
          dailyFiberGoalGrams: input.dailyFiberGoalGrams,
          sourceMessageId: input.sourceMessageId,
          updatedAt: new Date(),
        },
      })
      .returning();

    return profile ?? null;
  }

  static async getProfile({ identityId }: { identityId: string }) {
    const [profile] = await this.client
      .select()
      .from(agentNutritionProfiles)
      .where(eq(agentNutritionProfiles.identityId, identityId))
      .limit(1);

    return profile ?? null;
  }

  static async createDraft(input: NewAgentNutritionMeal) {
    return this.client.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(agentNutritionMeals)
        .where(
          and(
            eq(agentNutritionMeals.identityId, input.identityId),
            eq(agentNutritionMeals.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)
        .for('update');

      if (existing) {
        return this.#toDraftWriteOutcome(existing, false);
      }

      const now = new Date();

      await tx
        .update(agentNutritionMeals)
        .set({ status: 'deleted', deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(agentNutritionMeals.identityId, input.identityId),
            eq(agentNutritionMeals.threadId, input.threadId),
            eq(agentNutritionMeals.status, 'draft'),
          ),
        );

      const [meal] = await tx
        .insert(agentNutritionMeals)
        .values({ ...input, status: 'draft' })
        .onConflictDoNothing({
          target: [agentNutritionMeals.identityId, agentNutritionMeals.idempotencyKey],
        })
        .returning();

      if (meal) {
        return this.#toDraftWriteOutcome(meal, true);
      }

      const [replayedMeal] = await tx
        .select()
        .from(agentNutritionMeals)
        .where(
          and(
            eq(agentNutritionMeals.identityId, input.identityId),
            eq(agentNutritionMeals.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)
        .for('update');

      if (!replayedMeal) {
        throw new AppError({
          code: AppErrorCode.NUTRITION_PERSISTENCE_FAILED,
          message: 'Nutrition draft conflict could not be resolved.',
          context: {
            identityId: input.identityId,
            threadId: input.threadId,
            sourceMessageId: input.sourceMessageId,
          },
          retryable: true,
          userMessage: 'I could not save that nutrition update right now.',
        });
      }

      return this.#toDraftWriteOutcome(replayedMeal, false);
    });
  }

  static async getPendingDraft({ identityId, threadId }: NutritionThreadInput) {
    const [meal] = await this.client
      .select()
      .from(agentNutritionMeals)
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.threadId, threadId),
          eq(agentNutritionMeals.status, 'draft'),
        ),
      )
      .limit(1);

    return meal ?? null;
  }

  static async confirmPendingDraft({
    identityId,
    threadId,
    confirmedAt,
  }: ConfirmNutritionDraftInput) {
    const [meal] = await this.client
      .update(agentNutritionMeals)
      .set({ status: 'confirmed', confirmedAt, updatedAt: confirmedAt })
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.threadId, threadId),
          eq(agentNutritionMeals.status, 'draft'),
        ),
      )
      .returning();

    return meal ?? null;
  }

  static async updateMeal({ identityId, mealId, update }: UpdateNutritionMealInput) {
    const [meal] = await this.client
      .update(agentNutritionMeals)
      .set({ ...update, updatedAt: new Date() })
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.id, mealId),
          ne(agentNutritionMeals.status, 'deleted'),
        ),
      )
      .returning();

    return meal ?? null;
  }

  static async deleteMeal({ identityId, mealId, deletedAt }: DeleteNutritionMealInput) {
    const [meal] = await this.client
      .update(agentNutritionMeals)
      .set({ status: 'deleted', deletedAt, updatedAt: deletedAt })
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.id, mealId),
          ne(agentNutritionMeals.status, 'deleted'),
        ),
      )
      .returning();

    return meal ?? null;
  }

  static async getMeal({ identityId, mealId }: GetNutritionMealInput) {
    const [meal] = await this.client
      .select()
      .from(agentNutritionMeals)
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.id, mealId),
          ne(agentNutritionMeals.status, 'deleted'),
        ),
      )
      .limit(1);

    return meal ?? null;
  }

  static async listConfirmedMealsForDate({ identityId, localDate }: NutritionDateInput) {
    return this.client
      .select()
      .from(agentNutritionMeals)
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.localDate, localDate),
          eq(agentNutritionMeals.status, 'confirmed'),
        ),
      )
      .orderBy(asc(agentNutritionMeals.eatenAt));
  }

  static async getConfirmedTotalsForDate({ identityId, localDate }: NutritionDateInput) {
    const [totals] = await this.client
      .select({
        mealCount: sql<number>`count(*)::int`,
        calories: sql<number>`coalesce(sum(${agentNutritionMeals.calories}), 0)::int`,
        proteinGrams: sql<number>`coalesce(sum(${agentNutritionMeals.proteinGrams}), 0)::float8`,
        carbsGrams: sql<number>`coalesce(sum(${agentNutritionMeals.carbsGrams}), 0)::float8`,
        fatGrams: sql<number>`coalesce(sum(${agentNutritionMeals.fatGrams}), 0)::float8`,
        fiberGrams: sql<number>`coalesce(sum(${agentNutritionMeals.fiberGrams}), 0)::float8`,
      })
      .from(agentNutritionMeals)
      .where(
        and(
          eq(agentNutritionMeals.identityId, identityId),
          eq(agentNutritionMeals.localDate, localDate),
          eq(agentNutritionMeals.status, 'confirmed'),
        ),
      );

    return {
      mealCount: totals?.mealCount ?? 0,
      calories: totals?.calories ?? 0,
      proteinGrams: totals?.proteinGrams ?? 0,
      carbsGrams: totals?.carbsGrams ?? 0,
      fatGrams: totals?.fatGrams ?? 0,
      fiberGrams: totals?.fiberGrams ?? 0,
    };
  }

  static #toDraftWriteOutcome(meal: AgentNutritionMeal, created: boolean) {
    if (created) {
      return { outcome: 'created' as const, meal };
    }

    if (meal.status === 'draft') {
      return { outcome: 'existing_draft' as const, meal };
    }

    if (meal.status === 'confirmed') {
      return { outcome: 'already_confirmed' as const, meal };
    }

    return { outcome: 'stale_replay' as const, meal };
  }
}

type NutritionThreadInput = {
  identityId: string;
  threadId: string;
};

type ConfirmNutritionDraftInput = NutritionThreadInput & {
  confirmedAt: Date;
};

type NutritionDateInput = {
  identityId: string;
  localDate: string;
};

type GetNutritionMealInput = {
  identityId: string;
  mealId: string;
};

type UpdateNutritionMealInput = GetNutritionMealInput & {
  update: Partial<
    Pick<
      AgentNutritionMeal,
      | 'name'
      | 'items'
      | 'calories'
      | 'caloriesMin'
      | 'caloriesMax'
      | 'proteinGrams'
      | 'carbsGrams'
      | 'fatGrams'
      | 'fiberGrams'
      | 'confidence'
      | 'localDate'
      | 'eatenAt'
    >
  >;
};

type DeleteNutritionMealInput = GetNutritionMealInput & {
  deletedAt: Date;
};

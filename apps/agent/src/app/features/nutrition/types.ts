import type {
  NutritionConfidenceSchema,
  NutritionGoalsSchema,
  NutritionGoalUpdateSchema,
  NutritionMealEstimateSchema,
  NutritionMealItemSchema,
} from '@/app/features/nutrition/schemas';
import type { z } from 'zod';

export type NutritionConfidence = z.infer<typeof NutritionConfidenceSchema>;
export type NutritionGoalUpdate = z.infer<typeof NutritionGoalUpdateSchema>;
export type NutritionGoals = z.infer<typeof NutritionGoalsSchema>;
export type NutritionMealEstimate = z.infer<typeof NutritionMealEstimateSchema>;
export type NutritionMealItem = z.infer<typeof NutritionMealItemSchema>;

export type SetNutritionGoalsInput = {
  identityId: string;
  goals: NutritionGoalUpdate;
  sourceMessageId?: string;
};

export type CreateNutritionDraftInput = {
  identityId: string;
  threadId: string;
  estimate: NutritionMealEstimate;
  timeZone: string;
  sourceMessageId?: string;
  now?: Date;
};

export type GetNutritionStatusInput = {
  identityId: string;
  timeZone: string;
  localDate?: string;
  now?: Date;
};

export type NutritionThreadInput = {
  identityId: string;
  threadId: string;
};

export type ConfirmNutritionDraftInput = NutritionThreadInput & {
  timeZone: string;
  now?: Date;
};

export type CorrectNutritionMealInput = NutritionThreadInput & {
  mealId?: string;
  estimate: NutritionMealEstimate;
  timeZone: string;
  now?: Date;
};

export type DeleteNutritionMealInput = {
  identityId: string;
  mealId: string;
  now?: Date;
};

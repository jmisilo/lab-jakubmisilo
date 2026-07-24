import { z } from 'zod';

export const NutritionMealItemSchema = z.object({
  name: z.string().min(1).max(120),
  estimatedGrams: z.number().positive().max(5_000),
  preparationMethod: z.string().min(1).max(120),
  calories: z.number().min(0).max(10_000),
  proteinGrams: z.number().min(0).max(1_000),
  carbsGrams: z.number().min(0).max(2_000),
  fatGrams: z.number().min(0).max(1_000),
  fiberGrams: z.number().min(0).max(500),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().max(500).optional(),
});

export const NutritionMealEstimateSchema = z.object({
  name: z.string().min(1).max(180),
  items: z.array(NutritionMealItemSchema).min(1).max(30),
  source: z.enum(['photo', 'text', 'manual']),
  confidence: z.enum(['high', 'medium', 'low']),
  caloriesMin: z.number().int().min(0).max(20_000).optional(),
  caloriesMax: z.number().int().min(0).max(20_000).optional(),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
});

export const NutritionGoalsSchema = z.object({
  dailyCaloriesGoal: z.number().int().min(500).max(10_000).optional(),
  dailyProteinGoalGrams: z.number().min(0).max(1_000).nullable().optional(),
  dailyCarbsGoalGrams: z.number().min(0).max(2_000).nullable().optional(),
  dailyFatGoalGrams: z.number().min(0).max(1_000).nullable().optional(),
  dailyFiberGoalGrams: z.number().min(0).max(500).nullable().optional(),
});

export const ReadNutritionInputSchema = z.object({
  action: z.enum(['status', 'pending']),
  localDate: z.iso.date().optional(),
});

export const ManageNutritionInputSchema = z.object({
  action: z.enum(['set_goals', 'propose_meal', 'confirm', 'correct', 'delete']),
  goals: NutritionGoalsSchema.optional(),
  estimate: NutritionMealEstimateSchema.optional(),
  mealId: z.uuid().optional(),
});

export const ManageNutritionRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_goals'),
    goals: NutritionGoalsSchema,
  }),
  z.object({
    action: z.literal('propose_meal'),
    estimate: NutritionMealEstimateSchema,
  }),
  z.object({ action: z.literal('confirm') }),
  z.object({
    action: z.literal('correct'),
    mealId: z.uuid().optional(),
    estimate: NutritionMealEstimateSchema,
  }),
  z.object({
    action: z.literal('delete'),
    mealId: z.uuid(),
  }),
]);

import { z } from 'zod';

export const NutritionConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const NutritionMealSourceSchema = z.enum(['photo', 'text', 'manual']);

export const NutritionMealItemSchema = z.object({
  name: z.string().min(1).max(120),
  estimatedGrams: z.number().positive().max(5_000),
  preparationMethod: z.string().min(1).max(120),
  calories: z.number().min(0).max(10_000),
  proteinGrams: z.number().min(0).max(1_000),
  carbsGrams: z.number().min(0).max(2_000),
  fatGrams: z.number().min(0).max(1_000),
  fiberGrams: z.number().min(0).max(500),
  confidence: NutritionConfidenceSchema,
  notes: z.string().max(500).optional(),
});

export const NutritionMealEstimateSchema = z.object({
  name: z.string().min(1).max(180),
  items: z.array(NutritionMealItemSchema).min(1).max(30),
  source: NutritionMealSourceSchema,
  confidence: NutritionConfidenceSchema,
  caloriesMin: z.number().int().min(0).max(20_000).optional(),
  caloriesMax: z.number().int().min(0).max(20_000).optional(),
  eatenAt: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('When the meal was eaten as ISO datetime with Z or a numeric offset.'),
});

export const NutritionGoalsSchema = z.object({
  dailyCaloriesGoal: z.number().int().min(500).max(10_000),
  dailyProteinGoalGrams: z.number().min(0).max(1_000).nullable(),
  dailyCarbsGoalGrams: z.number().min(0).max(2_000).nullable(),
  dailyFatGoalGrams: z.number().min(0).max(1_000).nullable(),
  dailyFiberGoalGrams: z.number().min(0).max(500).nullable(),
});

export const NutritionGoalUpdateSchema = z
  .object({
    dailyCaloriesGoal: z.number().int().min(500).max(10_000).optional(),
    dailyProteinGoalGrams: z.number().min(0).max(1_000).nullable().optional(),
    dailyCarbsGoalGrams: z.number().min(0).max(2_000).nullable().optional(),
    dailyFatGoalGrams: z.number().min(0).max(1_000).nullable().optional(),
    dailyFiberGoalGrams: z.number().min(0).max(500).nullable().optional(),
  })
  .refine((goals) => Object.values(goals).some((value) => value !== undefined), {
    message: 'At least one nutrition goal must be provided.',
  });

export const NutritionToolContextSchema = z.object({
  identityId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  sourceMessageId: z.string().optional(),
  timeZone: z.string().min(1),
  mode: z.enum(['chat', 'scheduled_task']).optional(),
});

export const ReadNutritionToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get_status'),
    localDate: z.iso
      .date()
      .optional()
      .describe('Optional local date in YYYY-MM-DD. Defaults to today.'),
  }),
  z.object({
    action: z.literal('get_pending_draft'),
  }),
]);

export const ManageNutritionToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_goals'),
    goals: NutritionGoalUpdateSchema,
  }),
  z.object({
    action: z.literal('propose_meal'),
    estimate: NutritionMealEstimateSchema,
  }),
  z.object({
    action: z.literal('confirm_draft'),
  }),
  z.object({
    action: z.literal('correct_meal'),
    mealId: z
      .string()
      .uuid()
      .optional()
      .describe('Exact meal id from a read result. Omit to correct the pending draft.'),
    estimate: NutritionMealEstimateSchema,
  }),
  z.object({
    action: z.literal('delete_meal'),
    mealId: z.string().uuid().describe('Exact meal id from a read result.'),
  }),
]);

const NutritionToolProfileSchema = NutritionGoalsSchema;

const NutritionToolMealSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'confirmed', 'deleted']),
  name: z.string(),
  items: z.array(NutritionMealItemSchema),
  source: NutritionMealSourceSchema,
  calories: z.number(),
  caloriesMin: z.number().nullable(),
  caloriesMax: z.number().nullable(),
  proteinGrams: z.number(),
  carbsGrams: z.number(),
  fatGrams: z.number(),
  fiberGrams: z.number(),
  confidence: NutritionConfidenceSchema,
  localDate: z.string(),
  eatenAt: z.string(),
});

const NutritionToolTotalsSchema = z.object({
  mealCount: z.number().int(),
  calories: z.number(),
  proteinGrams: z.number(),
  carbsGrams: z.number(),
  fatGrams: z.number(),
  fiberGrams: z.number(),
});

const NutritionToolRemainingSchema = z.object({
  calories: z.number(),
  proteinGrams: z.number().nullable(),
  carbsGrams: z.number().nullable(),
  fatGrams: z.number().nullable(),
  fiberGrams: z.number().nullable(),
});

const NutritionToolStatusSchema = z.object({
  localDate: z.string(),
  profile: NutritionToolProfileSchema.nullable(),
  totals: NutritionToolTotalsSchema,
  remaining: NutritionToolRemainingSchema.nullable(),
  meals: z.array(NutritionToolMealSchema),
});

export const NutritionToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  profile: NutritionToolProfileSchema.optional(),
  meal: NutritionToolMealSchema.optional(),
  status: NutritionToolStatusSchema.optional(),
});

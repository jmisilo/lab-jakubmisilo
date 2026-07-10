import { AgentNutritionService } from '@/app/features/nutrition';

const mockNutritionDbService = {
  upsertProfile: jest.fn(),
  getProfile: jest.fn(),
  createDraft: jest.fn(),
  getPendingDraft: jest.fn(),
  confirmPendingDraft: jest.fn(),
  updateMeal: jest.fn(),
  deleteMeal: jest.fn(),
  getMeal: jest.fn(),
  listConfirmedMealsForDate: jest.fn(),
  getConfirmedTotalsForDate: jest.fn(),
};

jest.mock('@/infrastructure/db/services/agent-nutrition', () => ({
  AgentNutritionDbService: mockNutritionDbService,
}));

const NOW = new Date('2026-07-10T22:30:00.000Z');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AgentNutritionService', () => {
  it('creates a complete profile from an initial calorie goal', async () => {
    mockNutritionDbService.getProfile.mockResolvedValue(null);
    mockNutritionDbService.upsertProfile.mockImplementation((input) => input);

    const profile = await AgentNutritionService.setGoals({
      identityId: 'identity-1',
      goals: { dailyCaloriesGoal: 2_200 },
      sourceMessageId: 'message-1',
    });

    expect(mockNutritionDbService.upsertProfile).toHaveBeenCalledWith({
      identityId: 'identity-1',
      dailyCaloriesGoal: 2_200,
      dailyProteinGoalGrams: null,
      dailyCarbsGoalGrams: null,
      dailyFatGoalGrams: null,
      dailyFiberGoalGrams: null,
      sourceMessageId: 'message-1',
    });
    expect(profile.dailyCaloriesGoal).toBe(2_200);
  });

  it('requires a calorie goal when creating the first profile', async () => {
    mockNutritionDbService.getProfile.mockResolvedValue(null);

    await expect(
      AgentNutritionService.setGoals({
        identityId: 'identity-1',
        goals: { dailyProteinGoalGrams: 150 },
      }),
    ).rejects.toMatchObject({ code: 'NUTRITION_GOAL_REQUIRED' });
  });

  it('preserves omitted goals and clears explicitly null macro goals', async () => {
    mockNutritionDbService.getProfile.mockResolvedValue(createProfile());
    mockNutritionDbService.upsertProfile.mockImplementation((input) => input);

    await AgentNutritionService.setGoals({
      identityId: 'identity-1',
      goals: {
        dailyProteinGoalGrams: null,
        dailyFiberGoalGrams: 35,
      },
      sourceMessageId: 'message-2',
    });

    expect(mockNutritionDbService.upsertProfile).toHaveBeenCalledWith({
      identityId: 'identity-1',
      dailyCaloriesGoal: 2_200,
      dailyProteinGoalGrams: null,
      dailyCarbsGoalGrams: 250,
      dailyFatGoalGrams: 70,
      dailyFiberGoalGrams: 35,
      sourceMessageId: 'message-2',
    });
  });

  it('aggregates item nutrition and creates a local-date draft', async () => {
    mockNutritionDbService.createDraft.mockImplementation((input) => ({
      meal: createMeal(input),
      created: true,
    }));

    const result = await AgentNutritionService.createMealDraft({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      timeZone: 'Europe/Warsaw',
      sourceMessageId: 'message-1',
      now: NOW,
      estimate: createEstimate(),
    });

    expect(mockNutritionDbService.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        status: 'draft',
        calories: 500,
        caloriesMin: 400,
        caloriesMax: 600,
        proteinGrams: 38,
        carbsGrams: 53,
        fatGrams: 14,
        fiberGrams: 6,
        localDate: '2026-07-11',
        eatenAt: NOW,
        idempotencyKey: 'message-1:nutrition-draft',
      }),
    );
    expect(result.meal.calories).toBe(500);
  });

  it('returns daily totals, goals, remaining macros, and confirmed meals', async () => {
    mockNutritionDbService.getProfile.mockResolvedValue(createProfile());
    mockNutritionDbService.getConfirmedTotalsForDate.mockResolvedValue({
      mealCount: 2,
      calories: 1_400,
      proteinGrams: 90,
      carbsGrams: 160,
      fatGrams: 45,
      fiberGrams: 18,
    });
    mockNutritionDbService.listConfirmedMealsForDate.mockResolvedValue([createMeal()]);

    const status = await AgentNutritionService.getStatus({
      identityId: 'identity-1',
      timeZone: 'Europe/Warsaw',
      now: NOW,
    });

    expect(status.localDate).toBe('2026-07-11');
    expect(status.remaining).toEqual({
      calories: 800,
      proteinGrams: 60,
      carbsGrams: 90,
      fatGrams: 25,
      fiberGrams: 12,
    });
    expect(status.meals).toHaveLength(1);
  });

  it('confirms the pending draft before including it in daily status', async () => {
    const confirmedMeal = createMeal({
      status: 'confirmed',
      confirmedAt: NOW,
    });
    mockNutritionDbService.confirmPendingDraft.mockResolvedValue(confirmedMeal);
    mockNutritionDbService.getProfile.mockResolvedValue(createProfile());
    mockNutritionDbService.getConfirmedTotalsForDate.mockResolvedValue({
      mealCount: 1,
      calories: 500,
      proteinGrams: 38,
      carbsGrams: 53,
      fatGrams: 14,
      fiberGrams: 6,
    });
    mockNutritionDbService.listConfirmedMealsForDate.mockResolvedValue([confirmedMeal]);

    const result = await AgentNutritionService.confirmPendingDraft({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      timeZone: 'Europe/Warsaw',
      now: NOW,
    });

    expect(mockNutritionDbService.confirmPendingDraft).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      confirmedAt: NOW,
    });
    expect(result.meal.status).toBe('confirmed');
    expect(result.status.totals.calories).toBe(500);
  });

  it('corrects the pending draft using recalculated item totals', async () => {
    mockNutritionDbService.getPendingDraft.mockResolvedValue(createMeal());
    mockNutritionDbService.updateMeal.mockImplementation(({ update }) => createMeal({ ...update }));

    const meal = await AgentNutritionService.correctMeal({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      timeZone: 'Europe/Warsaw',
      now: NOW,
      estimate: createEstimate({
        items: [
          {
            ...createEstimate().items[0]!,
            calories: 300,
            proteinGrams: 25,
          },
        ],
      }),
    });

    expect(mockNutritionDbService.updateMeal).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        mealId: 'meal-1',
        update: expect.objectContaining({ calories: 300, proteinGrams: 25 }),
      }),
    );
    expect(meal.calories).toBe(300);
  });
});

function createEstimate(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Chicken and rice',
    source: 'photo' as const,
    confidence: 'medium' as const,
    items: [
      {
        name: 'Chicken breast',
        estimatedGrams: 150,
        preparationMethod: 'grilled',
        calories: 300,
        proteinGrams: 35,
        carbsGrams: 3,
        fatGrams: 12,
        fiberGrams: 0,
        confidence: 'medium' as const,
      },
      {
        name: 'Rice',
        estimatedGrams: 150,
        preparationMethod: 'boiled',
        calories: 200,
        proteinGrams: 3,
        carbsGrams: 50,
        fatGrams: 2,
        fiberGrams: 6,
        confidence: 'medium' as const,
      },
    ],
    ...overrides,
  };
}

function createProfile() {
  return {
    identityId: 'identity-1',
    dailyCaloriesGoal: 2_200,
    dailyProteinGoalGrams: 150,
    dailyCarbsGoalGrams: 250,
    dailyFatGoalGrams: 70,
    dailyFiberGoalGrams: 30,
    sourceMessageId: 'message-1',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'meal-1',
    identityId: 'identity-1',
    threadId: 'telegram:1',
    status: 'draft' as const,
    name: 'Chicken and rice',
    items: createEstimate().items,
    source: 'photo' as const,
    calories: 500,
    caloriesMin: 400,
    caloriesMax: 600,
    proteinGrams: 38,
    carbsGrams: 53,
    fatGrams: 14,
    fiberGrams: 6,
    confidence: 'medium' as const,
    localDate: '2026-07-11',
    eatenAt: NOW,
    idempotencyKey: 'message-1:nutrition-draft',
    sourceMessageId: 'message-1',
    confirmedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

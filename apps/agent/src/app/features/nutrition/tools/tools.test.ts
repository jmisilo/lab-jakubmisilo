const mockNutritionService = {
  setGoals: jest.fn(),
  createMealDraft: jest.fn(),
  getStatus: jest.fn(),
  getPendingDraft: jest.fn(),
  confirmPendingDraft: jest.fn(),
  correctMeal: jest.fn(),
  deleteMeal: jest.fn(),
};

jest.mock('ai', () => ({
  tool: jest.fn((definition) => definition),
}));

jest.mock('@/app/features/nutrition', () => ({
  AgentNutritionService: mockNutritionService,
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

let manageNutritionTool: typeof import('.').manageNutritionTool;
let readNutritionTool: typeof import('.').readNutritionTool;

const NOW = new Date('2026-07-10T12:00:00.000Z');

beforeAll(async () => {
  ({ manageNutritionTool, readNutritionTool } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('nutrition tools', () => {
  it('creates a meal estimate draft without claiming it was logged', async () => {
    mockNutritionService.createMealDraft.mockResolvedValue({
      meal: createMeal(),
      outcome: 'created',
    });

    const result = await manageNutritionTool.execute!(
      { action: 'propose_meal', estimate: createEstimate() },
      createToolOptions(),
    );

    expect(mockNutritionService.createMealDraft).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      timeZone: 'Europe/Warsaw',
      sourceMessageId: 'message-1',
      estimate: createEstimate(),
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'Meal estimate saved as a draft. It is not logged until the user confirms it.',
        meal: expect.objectContaining({ status: 'draft', calories: 500 }),
      }),
    );
  });

  it('reports an idempotent draft replay as still pending', async () => {
    mockNutritionService.createMealDraft.mockResolvedValue({
      meal: createMeal(),
      outcome: 'existing_draft',
    });

    const result = await manageNutritionTool.execute!(
      { action: 'propose_meal', estimate: createEstimate() },
      createToolOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'This meal estimate is already pending confirmation.',
        meal: expect.objectContaining({ status: 'draft' }),
      }),
    );
  });

  it('does not present a confirmed replay as a new draft', async () => {
    mockNutritionService.createMealDraft.mockResolvedValue({
      meal: createMeal({ status: 'confirmed', confirmedAt: NOW }),
      outcome: 'already_confirmed',
    });

    const result = await manageNutritionTool.execute!(
      { action: 'propose_meal', estimate: createEstimate() },
      createToolOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'This meal estimate was already logged.',
        meal: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
  });

  it('rejects a replay of a superseded draft', async () => {
    mockNutritionService.createMealDraft.mockResolvedValue({
      meal: createMeal({ status: 'deleted', deletedAt: NOW }),
      outcome: 'stale_replay',
    });

    const result = await manageNutritionTool.execute!(
      { action: 'propose_meal', estimate: createEstimate() },
      createToolOptions(),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        message: 'This meal estimate is no longer pending and was not logged again.',
        meal: expect.objectContaining({ status: 'deleted' }),
      }),
    );
  });

  it('confirms a draft and returns updated daily status', async () => {
    mockNutritionService.confirmPendingDraft.mockResolvedValue({
      meal: createMeal({ status: 'confirmed', confirmedAt: NOW }),
      status: createStatus(),
    });

    const result = await manageNutritionTool.execute!(
      { action: 'confirm_draft' },
      createToolOptions(),
    );

    expect(mockNutritionService.confirmPendingDraft).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      timeZone: 'Europe/Warsaw',
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'Meal logged.',
        status: expect.objectContaining({
          totals: expect.objectContaining({ calories: 1_400 }),
        }),
      }),
    );
  });

  it('reads nutrition status for a selected local date', async () => {
    mockNutritionService.getStatus.mockResolvedValue(createStatus());

    const result = await readNutritionTool.execute!(
      { action: 'get_status', localDate: '2026-07-10' },
      createToolOptions(),
    );

    expect(mockNutritionService.getStatus).toHaveBeenCalledWith({
      identityId: 'identity-1',
      timeZone: 'Europe/Warsaw',
      localDate: '2026-07-10',
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, status: expect.any(Object) }));
  });
});

function createToolOptions() {
  return {
    context: {
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
      timeZone: 'Europe/Warsaw',
      mode: 'chat' as const,
    },
  } as never;
}

function createEstimate() {
  return {
    name: 'Chicken and rice',
    source: 'photo' as const,
    confidence: 'medium' as const,
    items: [
      {
        name: 'Chicken and rice',
        estimatedGrams: 300,
        preparationMethod: 'grilled and boiled',
        calories: 500,
        proteinGrams: 38,
        carbsGrams: 53,
        fatGrams: 14,
        fiberGrams: 6,
        confidence: 'medium' as const,
      },
    ],
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
    id: '11111111-1111-4111-8111-111111111111',
    identityId: 'identity-1',
    threadId: 'telegram:1',
    status: 'draft' as const,
    ...createEstimate(),
    calories: 500,
    caloriesMin: 400,
    caloriesMax: 600,
    proteinGrams: 38,
    carbsGrams: 53,
    fatGrams: 14,
    fiberGrams: 6,
    localDate: '2026-07-10',
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

function createStatus() {
  return {
    localDate: '2026-07-10',
    profile: createProfile(),
    totals: {
      mealCount: 2,
      calories: 1_400,
      proteinGrams: 90,
      carbsGrams: 160,
      fatGrams: 45,
      fiberGrams: 18,
    },
    remaining: {
      calories: 800,
      proteinGrams: 60,
      carbsGrams: 90,
      fatGrams: 25,
      fiberGrams: 12,
    },
    meals: [createMeal({ status: 'confirmed', confirmedAt: NOW })],
  };
}

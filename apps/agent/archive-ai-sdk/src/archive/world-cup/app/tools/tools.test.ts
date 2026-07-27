const mockSubscriptionService = {
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  listTrackedSubscriptions: jest.fn(),
};

jest.mock('ai', () => ({
  tool: jest.fn((definition) => definition),
}));

jest.mock('@/archive/world-cup/app/tracking/subscription', () => ({
  WorldCupSubscriptionService: mockSubscriptionService,
}));

jest.mock('@/archive/world-cup/app/tracking/context', () => ({
  WorldCupContextService: { getContext: jest.fn() },
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

let manageWorldCupSubscriptionTool: typeof import('.').manageWorldCupSubscriptionTool;

beforeAll(async () => {
  ({ manageWorldCupSubscriptionTool } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('returns a safe typed failure when subscription persistence fails', async () => {
  mockSubscriptionService.subscribe.mockRejectedValue(
    new Error('database password and private subscription payload'),
  );

  const execute = manageWorldCupSubscriptionTool.execute!;
  const result = await execute({ action: 'subscribe', trackingMode: 'all_teams' }, {
    context: {
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
    },
  } as Parameters<typeof execute>[1]);

  expect(result).toEqual({
    ok: false,
    message: 'World Cup subscriptions are temporarily unavailable.',
  });
  expect(JSON.stringify(result)).not.toContain('database password');
});

const mockAgentObservabilityService = {
  createAgentTelemetry: jest.fn(),
  createCorrelationId: jest.fn(),
};
const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};
const mockOpenAI = Object.assign(
  jest.fn((modelId: string) => ({ modelId })),
  {
    embedding: jest.fn(() => ({ modelId: 'test-embedding-model' })),
    tools: {
      webSearch: jest.fn(() => ({})),
    },
  },
);

jest.mock('@ai-sdk/openai', () => ({
  openai: mockOpenAI,
}));

jest.mock('ai', () => ({
  embed: jest.fn(),
  generateText: jest.fn(),
  isStepCount: jest.fn(() => () => false),
  Output: {
    object: jest.fn((input) => input),
    text: jest.fn(() => ({})),
  },
  tool: jest.fn((input) => input),
  ToolLoopAgent: class ToolLoopAgent {
    readonly settings: unknown;
    readonly generate = jest.fn();

    constructor(settings: unknown) {
      this.settings = settings;
    }
  },
}));

jest.mock('@/infrastructure/observability', () => ({
  AgentObservabilityService: mockAgentObservabilityService,
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let AgentService: typeof import('.').AgentService;

beforeAll(async () => {
  ({ AgentService } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentObservabilityService.createAgentTelemetry.mockReturnValue({
    isEnabled: true,
    recordInputs: false,
    recordOutputs: false,
  });
  mockAgentObservabilityService.createCorrelationId.mockReturnValue(
    'eb698293-f8d6-47af-9ce6-d666189ef8ab',
  );
});

describe('AgentService observability', () => {
  it('uses GPT-5.6 Luna as the agent model', () => {
    expect(AgentService.agent).toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          model: { modelId: 'gpt-5.6-luna' },
        }),
      }),
    );
  });

  it('attaches per-call telemetry only when a correlation id is present', async () => {
    const prepareCall = getPrepareCall();
    const options = {
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat' as const,
      threadId: 'imessage:private-thread',
    };

    const prepared = await prepareCall({ options } as never);

    expect(mockAgentObservabilityService.createAgentTelemetry).toHaveBeenCalledWith(options);
    expect(prepared).toEqual(
      expect.objectContaining({
        telemetry: {
          isEnabled: true,
          recordInputs: false,
          recordOutputs: false,
        },
      }),
    );

    mockAgentObservabilityService.createAgentTelemetry.mockClear();

    const uncorrelated = await prepareCall({ options: { identityId: '+48123123123' } } as never);

    expect(uncorrelated).toEqual(expect.objectContaining({ telemetry: { isEnabled: false } }));
    expect(mockAgentObservabilityService.createAgentTelemetry).not.toHaveBeenCalled();
  });

  it('uses explicit GPT-5.6 prompt caching with a 30-minute minimum lifetime', async () => {
    const prepared = await getPrepareCall()({
      options: {
        identityId: '+48123123123',
        mode: 'chat',
        threadId: 'imessage:private-thread',
      },
    } as never);

    expect(prepared).toEqual(
      expect.objectContaining({
        instructions: expect.objectContaining({
          providerOptions: {
            openai: {
              promptCacheBreakpoint: { mode: 'explicit' },
            },
          },
          role: 'system',
        }),
        providerOptions: {
          openai: expect.objectContaining({
            promptCacheOptions: {
              mode: 'explicit',
              ttl: '30m',
            },
          }),
        },
      }),
    );
    expect(prepared).not.toEqual(
      expect.objectContaining({
        providerOptions: {
          openai: expect.objectContaining({ promptCacheRetention: expect.anything() }),
        },
      }),
    );
  });

  it('uses the same correlation id in generation options and the success log', async () => {
    const generate = jest.spyOn(AgentService.agent, 'generate').mockResolvedValue({
      finishReason: 'stop',
      steps: [],
      text: 'Hello.',
      usage: {
        inputTokenDetails: {
          cacheReadTokens: 1,
          cacheWriteTokens: 2,
          noCacheTokens: 3,
        },
        inputTokens: 4,
        outputTokens: 5,
        totalTokens: 9,
      },
    } as never);

    try {
      await expect(
        AgentService.generate({
          identityId: '+48123123123',
          messages: [{ role: 'user', content: 'Hello' }],
          threadId: 'imessage:private-thread',
        }),
      ).resolves.toEqual({ text: 'Hello.' });

      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
          }),
        }),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
        }),
        '[AI_AGENT]: response generated',
      );
    } finally {
      generate.mockRestore();
    }
  });

  it('includes the correlation id in a failed generation log', async () => {
    const failure = new Error('provider failed');
    const generate = jest.spyOn(AgentService.agent, 'generate').mockRejectedValue(failure);

    try {
      await expect(
        AgentService.generate({
          identityId: '+48123123123',
          messages: [{ role: 'user', content: 'Hello' }],
          threadId: 'imessage:private-thread',
        }),
      ).rejects.toBe(failure);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
        }),
        '[AI_AGENT]: response generation failed',
      );
    } finally {
      generate.mockRestore();
    }
  });
});

function getPrepareCall() {
  const settings = (AgentService.agent as unknown as AgentForTest).settings;

  if (!settings.prepareCall) {
    throw new Error('Expected AgentService to configure prepareCall.');
  }

  return settings.prepareCall;
}

type AgentForTest = {
  settings: {
    prepareCall?: (input: never) => Promise<Record<string, unknown>> | Record<string, unknown>;
    tools?: Record<string, unknown>;
  };
};

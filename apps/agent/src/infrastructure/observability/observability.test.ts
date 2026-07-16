import { AppErrorCode } from '@/infrastructure/errors';

const mockAwaitPendingTraceBatches = jest.fn();
const mockClient = {
  awaitPendingTraceBatches: mockAwaitPendingTraceBatches,
};
const mockClientConstructor = jest.fn((config?: unknown) => {
  void config;

  return mockClient;
});
const mockBaseTelemetry = {
  onStart: jest.fn(acceptTelemetryEvent),
  onStepStart: jest.fn(acceptTelemetryEvent),
  onLanguageModelCallStart: jest.fn(acceptTelemetryEvent),
  onToolExecutionStart: jest.fn(acceptTelemetryEvent),
  onToolExecutionEnd: jest.fn(acceptTelemetryEvent),
  onStepFinish: jest.fn(acceptTelemetryEvent),
  onEnd: jest.fn(acceptTelemetryEvent),
  onError: jest.fn(acceptTelemetryEvent),
  executeTool: jest.fn(acceptTelemetryEvent),
};
const mockLangSmithTelemetry = jest.fn((config?: unknown) => {
  void config;

  return mockBaseTelemetry;
});

jest.mock('langsmith', () => ({
  Client: mockClientConstructor,
}));

jest.mock('langsmith/experimental/vercel', () => ({
  LangSmithTelemetry: mockLangSmithTelemetry,
}));

describe('AgentObservabilityService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockAwaitPendingTraceBatches.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('never enables tracing in the test environment', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'test';
    const { AgentObservabilityService } = await import('.');

    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });

    expect(telemetry).toEqual(expect.objectContaining({ isEnabled: false }));
    expect(mockClientConstructor).not.toHaveBeenCalled();
    expect(mockLangSmithTelemetry).not.toHaveBeenCalled();
  });

  it('stays disabled unless tracing is explicitly enabled', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    process.env.LANGSMITH_TRACING = 'false';
    const { AgentObservabilityService } = await import('.');

    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });

    expect(telemetry).toEqual(expect.objectContaining({ isEnabled: false }));
    expect(mockClientConstructor).not.toHaveBeenCalled();
    expect(mockLangSmithTelemetry).not.toHaveBeenCalled();
  });

  it.each([
    ['an API key', 'LANGSMITH_API_KEY'],
    ['the EU endpoint', 'LANGSMITH_ENDPOINT'],
    ['a project', 'LANGSMITH_PROJECT'],
    ['a valid pseudonymization key', 'AGENT_OBSERVABILITY_HASH_KEY'],
  ])('stays disabled when enabled tracing is missing %s', async (_description, variable) => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    delete process.env[variable];
    const { AgentObservabilityService } = await import('.');

    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });

    expect(telemetry).toEqual(expect.objectContaining({ isEnabled: false }));
    expect(mockClientConstructor).not.toHaveBeenCalled();
    expect(mockLangSmithTelemetry).not.toHaveBeenCalled();
  });

  it('stays disabled when the pseudonymization key does not decode to 32 bytes', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    process.env.AGENT_OBSERVABILITY_HASH_KEY = Buffer.alloc(16, 7).toString('base64');
    const { AgentObservabilityService } = await import('.');

    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });

    expect(telemetry).toEqual(expect.objectContaining({ isEnabled: false }));
    expect(mockClientConstructor).not.toHaveBeenCalled();
  });

  it.each([
    ['sampling is below zero', 'LANGSMITH_TRACING_SAMPLING_RATE', '-0.1'],
    ['sampling is above one', 'LANGSMITH_TRACING_SAMPLING_RATE', '1.1'],
    ['input retention is not a boolean', 'LANGSMITH_HIDE_INPUTS', 'yes'],
    ['output retention is not a boolean', 'LANGSMITH_HIDE_OUTPUTS', 'no'],
  ])('stays disabled when %s', async (_description, variable, value) => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    process.env[variable] = value;
    const { AgentObservabilityService } = await import('.');

    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });

    expect(telemetry).toEqual(expect.objectContaining({ isEnabled: false }));
    expect(mockClientConstructor).not.toHaveBeenCalled();
    expect(mockLangSmithTelemetry).not.toHaveBeenCalled();
  });

  it('captures inputs and outputs when the owner explicitly enables both', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    process.env.LANGSMITH_HIDE_INPUTS = 'false';
    process.env.LANGSMITH_HIDE_OUTPUTS = 'false';
    const { AgentObservabilityService } = await import('.');
    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });
    const integration = getIntegration(telemetry);

    expect(telemetry).toEqual(
      expect.objectContaining({ isEnabled: true, recordInputs: true, recordOutputs: true }),
    );
    expect(getClientConfig()).toEqual(
      expect.objectContaining({ hideInputs: false, hideOutputs: false }),
    );
    expect(integration.onLanguageModelCallStart).toBe(mockBaseTelemetry.onLanguageModelCallStart);

    const toolEndEvent = {
      callId: 'call-1',
      messages: [{ role: 'user', content: 'private user message' }],
      recordInputs: true,
      recordOutputs: true,
      toolCall: {
        input: { query: 'private@example.com' },
        toolCallId: 'tool-call-1',
        toolName: 'read-gmail',
        type: 'tool-call',
      },
      toolContext: { identityId: '+48123123123' },
      toolExecutionMs: 42,
      toolOutput: {
        input: { query: 'private@example.com' },
        output: { message: 'private email body', ok: true },
        toolCallId: 'tool-call-1',
        toolName: 'read-gmail',
        type: 'tool-result',
      },
    } as never;

    await integration.onToolExecutionEnd?.(toolEndEvent);

    expect(mockBaseTelemetry.onToolExecutionEnd).toHaveBeenCalledWith(toolEndEvent);
  });

  it('creates metadata-only telemetry with stable pseudonyms and client-level masking', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
    const { AgentObservabilityService } = await import('.');

    const first = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });
    AgentObservabilityService.createAgentTelemetry({
      correlationId: '38b02e91-e6fd-44e0-b99e-005fd6d1172b',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });
    AgentObservabilityService.createAgentTelemetry({
      correlationId: '341c6d63-a552-4cf3-aa8e-d4f65ace266c',
      identityId: '+48999999999',
      mode: 'chat',
      threadId: 'imessage:another-private-thread',
    });

    expect(first).toEqual(
      expect.objectContaining({
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
        functionId: expect.any(String),
        integrations: [expect.any(Object)],
      }),
    );
    expect(mockClientConstructor).toHaveBeenCalledTimes(1);
    expect(mockLangSmithTelemetry).toHaveBeenCalledTimes(3);

    const firstConfig = getTelemetryConfig(0);
    const repeatedConfig = getTelemetryConfig(1);
    const differentConfig = getTelemetryConfig(2);

    expect(firstConfig).toEqual(
      expect.objectContaining({
        projectName: 'labjm-agent-development',
        metadata: expect.objectContaining({
          channel: 'imessage',
          correlation_id: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
          environment: 'staging',
          mode: 'chat',
          release: 'abcdef1234567890',
          thread_id: expect.any(String),
          user_id: expect.any(String),
        }),
        traceRawHttp: false,
        traceResponseMetadata: false,
      }),
    );
    expect(firstConfig.metadata.user_id).toBe(repeatedConfig.metadata.user_id);
    expect(firstConfig.metadata.thread_id).toBe(repeatedConfig.metadata.thread_id);
    expect(firstConfig.metadata.user_id).not.toBe(differentConfig.metadata.user_id);
    expect(firstConfig.metadata.thread_id).not.toBe(differentConfig.metadata.thread_id);

    const serializedConfig = JSON.stringify(mockLangSmithTelemetry.mock.calls);

    expect(serializedConfig).not.toContain('+48123123123');
    expect(serializedConfig).not.toContain('+48999999999');
    expect(serializedConfig).not.toContain('imessage:private-thread');
    expect(serializedConfig).not.toContain('imessage:another-private-thread');

    const clientConfig = getClientConfig();

    expect(clientConfig).toEqual(
      expect.objectContaining({
        apiKey: 'langsmith-api-key',
        apiUrl: 'https://eu.api.smith.langchain.com',
        callerOptions: { maxRetries: 1 },
        hideInputs: true,
        omitTracedRuntimeInfo: true,
        timeout_ms: 5_000,
        tracingSamplingRate: 1,
        workspaceId: 'workspace-1',
      }),
    );

    const hideMetadata = clientConfig.hideMetadata as MaskFunction;
    const hideOutputs = clientConfig.hideOutputs as MaskFunction;
    const anonymizer = clientConfig.anonymizer as MaskFunction;

    expect(typeof hideMetadata).toBe('function');
    expect(typeof hideOutputs).toBe('function');
    expect(typeof anonymizer).toBe('function');
    expect(
      await hideMetadata({
        correlation_id: 'correlation-1',
        environment: 'staging',
        promptCacheKey: 'private-prompt-cache-key',
        usage_metadata: { input_tokens: 123, private: 'secret' },
      }),
    ).toEqual({
      correlation_id: 'correlation-1',
      environment: 'staging',
      usage_metadata: { input_tokens: 123 },
    });
    expect(
      await hideOutputs({
        finish_reason: 'stop',
        output: { outcome: 'success', private: 'secret' },
        text: 'private assistant response',
      }),
    ).toEqual({
      finish_reason: 'stop',
      output: { outcome: 'success' },
    });
    expect(await anonymizer({ error: AppErrorCode.GOOGLE_API_ERROR })).toEqual({
      error: AppErrorCode.GOOGLE_API_ERROR,
    });
    expect(await anonymizer({ error: 'private provider error' })).toEqual({
      error: 'UNCLASSIFIED_AGENT_FAILURE',
    });
  });

  it('omits unsafe language-model and execution wrappers and sanitizes tool outcomes and errors', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    const { AgentObservabilityService } = await import('.');
    const { AppError } = await import('@/infrastructure/errors');
    const telemetry = AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });
    const integration = getIntegration(telemetry);

    expect(integration.onLanguageModelCallStart).toBeUndefined();
    expect(integration.executeTool).toBeUndefined();

    await integration.onToolExecutionEnd?.({
      callId: 'call-1',
      messages: [{ role: 'user', content: 'private user message' }],
      recordInputs: true,
      recordOutputs: true,
      toolCall: {
        input: { query: 'private@example.com' },
        toolCallId: 'tool-call-1',
        toolName: 'read-gmail',
        type: 'tool-call',
      },
      toolContext: { identityId: '+48123123123' },
      toolExecutionMs: 42,
      toolOutput: {
        input: { query: 'private@example.com' },
        output: { message: 'private email body', ok: false },
        toolCallId: 'tool-call-1',
        toolName: 'read-gmail',
        type: 'tool-result',
      },
    } as never);

    expect(mockBaseTelemetry.onToolExecutionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [],
        recordInputs: false,
        recordOutputs: true,
        toolContext: undefined,
        toolOutput: expect.objectContaining({
          input: undefined,
          output: { outcome: 'returned_failure' },
          type: 'tool-result',
        }),
      }),
    );
    expect(JSON.stringify(mockBaseTelemetry.onToolExecutionEnd.mock.calls)).not.toContain(
      'private@example.com',
    );
    expect(JSON.stringify(mockBaseTelemetry.onToolExecutionEnd.mock.calls)).not.toContain(
      'private email body',
    );
    expect(JSON.stringify(mockBaseTelemetry.onToolExecutionEnd.mock.calls)).not.toContain(
      '+48123123123',
    );

    const knownFailure = new AppError({
      code: AppErrorCode.GOOGLE_API_ERROR,
      message: 'private provider failure',
    });

    await integration.onToolExecutionEnd?.({
      callId: 'call-2',
      messages: [{ role: 'user', content: 'private user message' }],
      toolCall: {
        input: { query: 'private@example.com' },
        toolCallId: 'tool-call-2',
        toolName: 'read-gmail',
        type: 'tool-call',
      },
      toolContext: { identityId: '+48123123123' },
      toolExecutionMs: 42,
      toolOutput: {
        error: knownFailure,
        input: { query: 'private@example.com' },
        toolCallId: 'tool-call-2',
        toolName: 'read-gmail',
        type: 'tool-error',
      },
    } as never);

    const sanitizedToolEnd = mockBaseTelemetry.onToolExecutionEnd.mock.calls.at(-1)?.[0] as {
      toolOutput: { error: Error };
    };
    const sanitizedToolError = sanitizedToolEnd.toolOutput.error;

    expect(sanitizedToolError).toBeInstanceOf(Error);
    expect(sanitizedToolError.message).toBe(AppErrorCode.GOOGLE_API_ERROR);
    expect(sanitizedToolError.message).not.toContain('private provider failure');

    await integration.onError?.({
      callId: 'call-3',
      error: new Error('private OpenAI error with token=secret'),
    });

    const sanitizedAgentError = mockBaseTelemetry.onError.mock.calls.at(-1)?.[0] as {
      callId: string;
      error: Error;
    };

    expect(sanitizedAgentError.callId).toBe('call-3');
    expect(sanitizedAgentError.error).toBeInstanceOf(Error);
    expect(sanitizedAgentError.error.message).toBe('UNCLASSIFIED_AGENT_FAILURE');
  });

  it('flushes pending traces without surfacing LangSmith failures', async () => {
    configureValidTracingEnvironment();
    process.env.NODE_ENV = 'development';
    const { AgentObservabilityService } = await import('.');

    AgentObservabilityService.createAgentTelemetry({
      correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
      identityId: '+48123123123',
      mode: 'chat',
      threadId: 'imessage:private-thread',
    });

    await expect(AgentObservabilityService.flush()).resolves.toBeUndefined();
    expect(mockAwaitPendingTraceBatches).toHaveBeenCalledTimes(1);

    mockAwaitPendingTraceBatches.mockRejectedValueOnce(new Error('LangSmith is unavailable'));

    await expect(AgentObservabilityService.flush()).resolves.toBeUndefined();
    expect(mockAwaitPendingTraceBatches).toHaveBeenCalledTimes(2);
  });

  it('stops waiting when a trace flush exceeds the serverless deadline', async () => {
    jest.useFakeTimers();

    try {
      configureValidTracingEnvironment();
      process.env.NODE_ENV = 'development';
      mockAwaitPendingTraceBatches.mockReturnValue(new Promise<void>(() => undefined));
      const { AgentObservabilityService } = await import('.');

      AgentObservabilityService.createAgentTelemetry({
        correlationId: 'eb698293-f8d6-47af-9ce6-d666189ef8ab',
        identityId: '+48123123123',
        mode: 'chat',
        threadId: 'imessage:private-thread',
      });

      const flush = AgentObservabilityService.flush();

      await jest.advanceTimersByTimeAsync(5_000);
      await expect(flush).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

function configureValidTracingEnvironment() {
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_API_KEY = 'langsmith-api-key';
  process.env.LANGSMITH_ENDPOINT = 'https://eu.api.smith.langchain.com';
  process.env.LANGSMITH_PROJECT = 'labjm-agent-development';
  process.env.LANGSMITH_WORKSPACE_ID = 'workspace-1';
  process.env.LANGSMITH_HIDE_INPUTS = 'true';
  process.env.LANGSMITH_HIDE_OUTPUTS = 'true';
  process.env.LANGSMITH_TRACING_SAMPLING_RATE = '1';
  process.env.AGENT_OBSERVABILITY_HASH_KEY = Buffer.alloc(32, 7).toString('base64');
}

function getTelemetryConfig(index: number) {
  const config = mockLangSmithTelemetry.mock.calls[index]?.[0];

  if (!config) {
    throw new Error(`Expected LangSmith telemetry config at call ${index}.`);
  }

  return config as unknown as TelemetryConfigForTest;
}

function getClientConfig() {
  const config = mockClientConstructor.mock.calls[0]?.[0];

  if (!config) {
    throw new Error('Expected LangSmith client config.');
  }

  return config as ClientConfigForTest;
}

function getIntegration(
  telemetry: ReturnType<AgentObservabilityServiceForTest['createAgentTelemetry']>,
) {
  const integration = Array.isArray(telemetry.integrations)
    ? telemetry.integrations[0]
    : telemetry.integrations;

  if (!integration) {
    throw new Error('Expected an observability integration.');
  }

  return integration;
}

type AgentObservabilityServiceForTest = (typeof import('.'))['AgentObservabilityService'];

type MaskFunction = (
  value: Record<string, unknown>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

type ClientConfigForTest = {
  anonymizer?: unknown;
  apiKey?: string;
  apiUrl?: string;
  callerOptions?: { maxRetries?: number };
  hideInputs?: unknown;
  hideMetadata?: unknown;
  hideOutputs?: unknown;
  omitTracedRuntimeInfo?: boolean;
  timeout_ms?: number;
  tracingSamplingRate?: number;
  workspaceId?: string;
};

type TelemetryConfigForTest = {
  metadata: Record<string, unknown>;
  processChildLLMRunInputs?: MaskFunction;
  processChildLLMRunOutputs?: MaskFunction;
  processInputs?: MaskFunction;
  processOutputs?: MaskFunction;
  projectName?: string;
  traceRawHttp?: boolean;
  traceResponseMetadata?: boolean;
};

function acceptTelemetryEvent(event?: unknown) {
  void event;
}

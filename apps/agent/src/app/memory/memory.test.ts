import type { agentTools as agentToolsType } from '@/app/agent/tools';
import type { AgentMemoryService as AgentMemoryServiceType } from '@/app/memory';
import type { AgentContextService as AgentContextServiceType } from '@/app/memory/context';

import {
  createMemoryChunk,
  createMessage,
  createNotedMemory,
} from '@/app/memory/__mocks__/fixtures';
import {
  agentMemoryDbServiceMock as mockAgentMemoryDbService,
  aiServiceMock as mockAIService,
} from '@/app/memory/__mocks__/services';
import { logger as mockLogger } from '@/infrastructure/logger';

jest.mock('@/infrastructure/db/services/agent-memory', () => ({
  AgentMemoryDbService: mockAgentMemoryDbService,
}));

jest.mock('@/app/ai', () => ({
  AIService: mockAIService,
}));

jest.mock('ai', () => ({
  tool: (definition: unknown) => definition,
}));

jest.mock('@ai-sdk/openai', () => ({
  openai: {
    tools: {
      webSearch: jest.fn(() => ({
        id: 'openai.web_search',
      })),
    },
  },
}));

let AgentMemoryService: typeof AgentMemoryServiceType;
let AgentContextService: typeof AgentContextServiceType;
let agentTools: typeof agentToolsType;

const overrideStaticProperty = <T extends object, K extends keyof T>({
  target,
  key,
  value,
}: {
  target: T;
  key: K;
  value: unknown;
}) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);

  Object.defineProperty(target, key, {
    value,
    configurable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    }
  };
};

beforeAll(async () => {
  ({ AgentMemoryService } = await import('.'));
  ({ AgentContextService } = await import('@/app/memory/context'));
  ({ agentTools } = await import('@/app/agent/tools'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AgentMemoryService', () => {
  describe('recordMessage', () => {
    it('persists normalized raw messages', async () => {
      mockAgentMemoryDbService.createMessage.mockResolvedValue(null);

      await AgentMemoryService.recordMessage({
        identityId: 'identity-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Remember that I prefer concise updates.',
        sourceMessageId: 'telegram-message-1',
      });

      expect(mockAgentMemoryDbService.createMessage).toHaveBeenCalledWith({
        identityId: 'identity-1',
        threadId: 'thread-1',
        role: 'user',
        content: 'Remember that I prefer concise updates.',
        sourceMessageId: 'telegram-message-1',
      });
    });
  });

  describe('recordNotedInfo', () => {
    it('embeds noted information before writing it to memory', async () => {
      mockAIService.embed.mockResolvedValue([0.4, 0.5, 0.6]);
      const createdMemory = createNotedMemory({
        id: 'noted-1',
        content: 'The user prefers direct Pino logger usage.',
      });
      mockAgentMemoryDbService.createNotedMemory.mockResolvedValue(createdMemory);

      const result = await AgentMemoryService.recordNotedInfo({
        identityId: 'identity-1',
        content: 'The user prefers direct Pino logger usage.',
        kind: 'preference',
        importance: 3,
        metadata: { source: 'test' },
      });

      expect(mockAgentMemoryDbService.createNotedMemory).toHaveBeenCalledWith({
        identityId: 'identity-1',
        content: 'The user prefers direct Pino logger usage.',
        kind: 'preference',
        importance: 3,
        metadata: { source: 'test' },
        embedding: [0.4, 0.5, 0.6],
      });
      expect(result).toBe(createdMemory);
    });
  });

  describe('compressShortTermMemory', () => {
    it('does not compress when uncompressed messages are under budget', async () => {
      mockAgentMemoryDbService.getUncompressedMessages.mockResolvedValue([
        createMessage({
          id: 'message-1',
          role: 'user',
          content: 'A small message.',
        }),
      ]);
      mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);

      await AgentMemoryService.compressShortTermMemory({
        identityId: 'identity-1',
        threadId: 'thread-1',
      });

      expect(mockAgentMemoryDbService.createMemoryChunk).not.toHaveBeenCalled();
      expect(mockAgentMemoryDbService.markMessagesCompressed).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'identity-1',
          threadId: 'thread-1',
        }),
        '[AGENT_MEMORY]: short-term memory under compression budget',
      );
    });

    it('compresses the oldest short-term messages when over budget', async () => {
      const messages = [
        createMessage({
          id: 'message-1',
          role: 'user',
          content: 'First durable decision: keep domain logic in services.',
        }),
        createMessage({
          id: 'message-2',
          role: 'assistant',
          content: 'I will keep domain logic in services.',
        }),
        createMessage({
          id: 'message-3',
          role: 'user',
          content: 'Second durable decision: avoid Eve routes.',
        }),
      ];

      mockAgentMemoryDbService.getUncompressedMessages.mockResolvedValue(messages);
      mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);
      jest.spyOn(AgentContextService, 'getCompressionTriggerTokenLimit').mockReturnValue(1);
      mockAIService.generate.mockResolvedValue(
        'The user prefers service-based domain logic and no Eve routes.',
      );
      mockAgentMemoryDbService.createMemoryChunk.mockResolvedValue(
        createMemoryChunk({
          id: 'chunk-1',
          summary: 'The user prefers service-based domain logic and no Eve routes.',
        }),
      );
      mockAgentMemoryDbService.markMessagesCompressed.mockResolvedValue(undefined);

      await AgentMemoryService.compressShortTermMemory({
        identityId: 'identity-1',
        threadId: 'thread-1',
      });

      expect(mockAIService.generate).toHaveBeenCalledWith({
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('Conversation:'),
          }),
        ],
      });
      expect(mockAgentMemoryDbService.createMemoryChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'identity-1',
          threadId: 'thread-1',
          summary: 'The user prefers service-based domain logic and no Eve routes.',
          metadata: expect.objectContaining({
            strategy: 'rolling_summary',
          }),
        }),
      );
      expect(mockAgentMemoryDbService.markMessagesCompressed).toHaveBeenCalledWith(
        expect.arrayContaining(['message-1']),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          identityId: 'identity-1',
          threadId: 'thread-1',
          compressedMessageCount: expect.any(Number),
        }),
        '[AGENT_MEMORY]: short-term memory compressed',
      );
    });

    it('logs compression failures without throwing', async () => {
      const error = new Error('db_unavailable');
      mockAgentMemoryDbService.getUncompressedMessages.mockRejectedValue(error);

      await expect(
        AgentMemoryService.compressShortTermMemory({
          identityId: 'identity-1',
          threadId: 'thread-1',
        }),
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        {
          identityId: 'identity-1',
          threadId: 'thread-1',
          error,
        },
        '[AGENT_MEMORY]: short-term memory compression failed',
      );
    });
  });
});

describe('AgentContextService', () => {
  it('assembles user-role memory context with semantic notes before recent fallback notes', async () => {
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentMemoryDbService.getNotedMemories.mockResolvedValue([
      createNotedMemory({
        id: 'recent-1',
        content: 'The user prefers concise implementation updates.',
        kind: 'preference',
      }),
      createNotedMemory({
        id: 'duplicate-1',
        content: 'The user avoids helper logger wrappers.',
        kind: 'preference',
      }),
    ]);
    mockAgentMemoryDbService.searchNotedMemories.mockResolvedValue([
      {
        ...createNotedMemory({
          id: 'semantic-1',
          content: 'The user wants direct Pino logger usage.',
          kind: 'preference',
        }),
        distance: 0.12,
      },
      {
        ...createNotedMemory({
          id: 'duplicate-1',
          content: 'The user avoids helper logger wrappers.',
          kind: 'preference',
        }),
        distance: 0.2,
      },
    ]);
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([
      createMemoryChunk({
        id: 'chunk-1',
        summary: 'Earlier discussion decided not to reintroduce Eve routes.',
      }),
    ]);

    const context = await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      shortTermMemory: [{ role: 'user', text: 'What should you remember about logging?' }],
    });

    expect(context[0]).toEqual(
      expect.objectContaining({
        role: 'user',
      }),
    );
    expect(context.some((message) => message.role === 'system')).toBe(false);

    const memoryContent = String(context[0]?.content);
    expect(memoryContent).toContain('Noted information:');
    expect(memoryContent).toContain('Compressed conversation memory:');
    expect(memoryContent).toContain('[AI-compressed]');
    expect(memoryContent.indexOf('direct Pino logger usage')).toBeLessThan(
      memoryContent.indexOf('concise implementation updates'),
    );
    expect(memoryContent.match(/avoids helper logger wrappers/g)).toHaveLength(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'thread-1',
        semanticNotedMemoryCount: 2,
        selectedCompressedChunkCount: 1,
      }),
      '[AGENT_MEMORY]: context assembled',
    );
  });

  it('keeps selected short-term transcript messages chronological', async () => {
    mockAIService.embed.mockResolvedValue([0.1]);
    mockAgentMemoryDbService.getNotedMemories.mockResolvedValue([]);
    mockAgentMemoryDbService.searchNotedMemories.mockResolvedValue([]);
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);

    const context = await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      shortTermMemory: [
        { role: 'user', text: 'First user message.' },
        { role: 'assistant', text: 'First assistant reply.' },
        { role: 'user', text: 'Latest user message.' },
      ],
    });

    expect(context).toEqual([
      { role: 'user', content: 'First user message.' },
      { role: 'assistant', content: 'First assistant reply.' },
      { role: 'user', content: 'Latest user message.' },
    ]);
  });

  it('lets short-term memory use unused compressed-memory budget', async () => {
    const restoreContextTokenLimit = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextTokenLimit',
      value: 100,
    });
    const restoreShortMemoryRatio = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextShortMemoryRatio',
      value: 0.1,
    });
    const restoreCompressedMemoryRatio = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextCompressedMemoryRatio',
      value: 0.5,
    });

    try {
      mockAIService.embed.mockResolvedValue([0.1]);
      mockAgentMemoryDbService.getNotedMemories.mockResolvedValue([]);
      mockAgentMemoryDbService.searchNotedMemories.mockResolvedValue([]);
      mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);

      const context = await AgentContextService.buildContext({
        identityId: 'identity-1',
        threadId: 'thread-1',
        shortTermMemory: [
          { role: 'user', text: 'Short memory item one.' },
          { role: 'assistant', text: 'Short memory item two.' },
          { role: 'user', text: 'Short memory item three.' },
          { role: 'assistant', text: 'Short memory item four.' },
          { role: 'user', text: 'Short memory item five.' },
        ],
      });

      expect(context).toEqual([
        { role: 'user', content: 'Short memory item one.' },
        { role: 'assistant', content: 'Short memory item two.' },
        { role: 'user', content: 'Short memory item three.' },
        { role: 'assistant', content: 'Short memory item four.' },
        { role: 'user', content: 'Short memory item five.' },
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedShortTermMessageCount: 5,
          selectedCompressedTokens: expect.any(Number),
        }),
        '[AGENT_MEMORY]: context assembled',
      );
    } finally {
      restoreContextTokenLimit();
      restoreShortMemoryRatio();
      restoreCompressedMemoryRatio();
    }
  });

  it('skips semantic noted-memory search when there is no current user query', async () => {
    mockAgentMemoryDbService.getNotedMemories.mockResolvedValue([]);
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);

    await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      shortTermMemory: [{ role: 'assistant', text: 'Assistant-only state.' }],
    });

    expect(mockAIService.embed).not.toHaveBeenCalled();
    expect(mockAgentMemoryDbService.searchNotedMemories).not.toHaveBeenCalled();
  });
});

describe('agent memory tools', () => {
  it('creates noted memory with identity from tool context', async () => {
    mockAIService.embed.mockResolvedValue([0.4, 0.5, 0.6]);
    mockAgentMemoryDbService.createNotedMemory.mockResolvedValue(
      createNotedMemory({
        id: 'noted-1',
        content: 'The user prefers static service classes.',
      }),
    );

    const result = await agentTools['create-noted-memory'].execute?.(
      {
        content: 'The user prefers static service classes.',
        kind: 'preference',
        importance: 3,
      },
      {
        abortSignal: new AbortController().signal,
        context: {
          identityId: 'identity-1',
        },
        messages: [],
        toolCallId: 'tool-call-1',
      },
    );

    expect(mockAgentMemoryDbService.createNotedMemory).toHaveBeenCalledWith({
      identityId: 'identity-1',
      content: 'The user prefers static service classes.',
      kind: 'preference',
      importance: 3,
      metadata: {
        source: 'agent_tool',
      },
      embedding: [0.4, 0.5, 0.6],
    });
    expect(result).toEqual({
      id: 'noted-1',
      saved: true,
    });
  });
});

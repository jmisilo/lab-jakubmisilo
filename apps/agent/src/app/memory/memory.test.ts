import type { AgentMemoryService as AgentMemoryServiceType } from '@/app/memory';
import type { AgentContextService as AgentContextServiceType } from '@/app/memory/context';

import { createMemoryChunk, createMessage } from '@/app/memory/__mocks__/fixtures';
import {
  agentKnowledgeServiceMock as mockAgentKnowledgeService,
  agentMemoryDbServiceMock as mockAgentMemoryDbService,
  aiServiceMock as mockAIService,
} from '@/app/memory/__mocks__/services';
import { logger as mockLogger } from '@/infrastructure/logger';

jest.mock('@/infrastructure/db/services/agent-memory', () => ({
  AgentMemoryDbService: mockAgentMemoryDbService,
}));

jest.mock('@/app/knowledge', () => ({
  AgentKnowledgeService: mockAgentKnowledgeService,
}));

jest.mock('@/infrastructure/ai', () => ({
  AIService: mockAIService,
}));

let AgentMemoryService: typeof AgentMemoryServiceType;
let AgentContextService: typeof AgentContextServiceType;

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
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentKnowledgeService.getContextItems.mockResolvedValue([]);
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
      mockAIService.generate.mockResolvedValue({
        text: 'The user prefers service-based domain logic and no Eve routes.',
      });
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

      const generateInput = mockAIService.generate.mock.calls[0]?.[0];
      const prompt = String(generateInput?.messages?.[0]?.content);

      expect(generateInput).toEqual(
        expect.objectContaining({
          reasoning: 'high',
          maxOutputTokens: AgentMemoryService.compressionSummaryMaxOutputTokens,
        }),
      );
      expect(prompt).toContain('# Task');
      expect(prompt).toContain('Create a high-fidelity rolling memory summary');
      expect(prompt).toContain('## Stable User Facts And Preferences');
      expect(prompt).toContain('## Decisions And Commitments');
      expect(prompt).toContain('## Tool And External-State Facts');
      expect(prompt).toContain('# Preserve');
      expect(prompt).toContain('# Discard');
      expect(prompt).toContain('Raw tool payloads');
      expect(prompt).toContain('# Conversation Transcript');
      expect(prompt).toContain(
        '[2026-01-01 01:00 Europe/Warsaw] user: First durable decision: keep domain logic in services.',
      );
      expect(prompt).toContain('First durable decision: keep domain logic in services.');
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
          safeError: {
            name: 'Error',
          },
        },
        '[AGENT_MEMORY]: short-term memory compression failed',
      );
    });
  });
});

describe('AgentContextService', () => {
  it('assembles rolling compressed memory after completed history and before the latest message', async () => {
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([
      createMemoryChunk({
        id: 'chunk-1',
        summary: 'Earlier discussion decided not to reintroduce Eve routes.',
      }),
    ]);

    const context = await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      shortTermMemory: [
        { role: 'user', text: 'Earlier question.' },
        { role: 'assistant', text: 'Earlier response.' },
        { role: 'user', text: 'What should you remember about logging?' },
      ],
    });

    expect(context[2]).toEqual(
      expect.objectContaining({
        role: 'user',
      }),
    );
    expect(context.some((message) => message.role === 'system')).toBe(false);

    const memoryContent = String(context[2]?.content);
    expect(memoryContent).toContain('Compressed conversation memory:');
    expect(memoryContent).toContain('[AI-compressed]');
    expect(memoryContent).toContain('Earlier discussion decided not to reintroduce Eve routes.');
    expect(context.slice(0, 2)).toEqual([
      { role: 'user', content: 'Earlier question.' },
      { role: 'assistant', content: 'Earlier response.' },
    ]);
    expect(context.at(-1)).toEqual({
      role: 'user',
      content: 'What should you remember about logging?',
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'thread-1',
        selectedCompressedChunkCount: 1,
        selectedKnowledgeItemCount: 0,
      }),
      '[AGENT_MEMORY]: context assembled',
    );
  });

  it('assembles durable knowledge before compressed memory and short-term transcript messages', async () => {
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([
      createMemoryChunk({
        id: 'chunk-1',
        summary: 'Earlier discussion decided to keep bot handlers static.',
      }),
    ]);
    mockAgentKnowledgeService.getContextItems.mockResolvedValue([
      '- [knowledge:match similarity=0.912] profile/location\n  Title: Default location\n  Content:\n  Warsaw is the user default location.',
    ]);

    const context = await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      shortTermMemory: [{ role: 'user', text: 'What is my default location?' }],
    });

    const memoryContent = String(context[0]?.content);
    expect(memoryContent).toContain('Durable knowledge:');
    expect(memoryContent).toContain('profile/location');
    expect(memoryContent).toContain('Compressed conversation memory:');
    expect(memoryContent.indexOf('Durable knowledge:')).toBeLessThan(
      memoryContent.indexOf('Compressed conversation memory:'),
    );
    expect(context.at(-1)).toEqual({
      role: 'user',
      content: 'What is my default location?',
    });
    expect(mockAgentKnowledgeService.getContextItems).toHaveBeenCalledWith({
      identityId: 'identity-1',
      shortTermMemory: [{ role: 'user', text: 'What is my default location?' }],
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedKnowledgeItemCount: 1,
        selectedCompressedChunkCount: 1,
      }),
      '[AGENT_MEMORY]: context assembled',
    );
  });

  it('truncates the last compressed memory chunk that exceeds its context budget', async () => {
    const restoreContextTokenLimit = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextTokenLimit',
      value: 90,
    });
    const restoreCompressedMemoryRatio = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextCompressedMemoryRatio',
      value: 0.6,
    });

    try {
      mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([
        createMemoryChunk({
          id: 'chunk-1',
          summary: `Keep this compressed summary start. ${'compressed detail '.repeat(80)}Do not include this compressed tail.`,
        }),
      ]);

      const context = await AgentContextService.buildContext({
        identityId: 'identity-1',
        threadId: 'thread-1',
        shortTermMemory: [],
      });

      const memoryContent = String(context[0]?.content);

      expect(memoryContent).toContain('Compressed conversation memory:');
      expect(memoryContent).toContain('Keep this compressed summary start.');
      expect(memoryContent).toContain('[truncated to fit context budget]');
      expect(memoryContent).not.toContain('Do not include this compressed tail.');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedCompressedChunkCount: 1,
        }),
        '[AGENT_MEMORY]: context assembled',
      );
    } finally {
      restoreContextTokenLimit();
      restoreCompressedMemoryRatio();
    }
  });

  it('truncates the last durable knowledge item that exceeds its context budget', async () => {
    const restoreContextTokenLimit = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextTokenLimit',
      value: 90,
    });
    const restoreKnowledgeRatio = overrideStaticProperty({
      target: AgentContextService,
      key: 'contextKnowledgeRatio',
      value: 0.6,
    });

    try {
      mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);
      mockAgentKnowledgeService.getContextItems.mockResolvedValue([
        `- [knowledge:match similarity=0.900] profile/long-note
  Title: Long note
  Content:
  Keep this durable knowledge start. ${'durable detail '.repeat(80)}Do not include this knowledge tail.`,
      ]);

      const context = await AgentContextService.buildContext({
        identityId: 'identity-1',
        threadId: 'thread-1',
        shortTermMemory: [{ role: 'user', text: 'What should you remember?' }],
      });

      const memoryContent = String(context[0]?.content);

      expect(memoryContent).toContain('Durable knowledge:');
      expect(memoryContent).toContain('profile/long-note');
      expect(memoryContent).toContain('Keep this durable knowledge start.');
      expect(memoryContent).toContain('[truncated to fit context budget]');
      expect(memoryContent).not.toContain('Do not include this knowledge tail.');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedKnowledgeItemCount: 1,
        }),
        '[AGENT_MEMORY]: context assembled',
      );
    } finally {
      restoreContextTokenLimit();
      restoreKnowledgeRatio();
    }
  });

  it('keeps selected short-term transcript messages chronological', async () => {
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

  it('adds local timestamps to short-term transcript messages when available', async () => {
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);

    const context = await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      timeZone: 'Europe/Warsaw',
      shortTermMemory: [
        {
          role: 'user',
          text: 'today my tasks are x, y, and z',
          timestamp: Date.parse('2026-07-09T07:00:00.000Z'),
        },
        {
          role: 'user',
          text: 'i finished x',
          timestamp: Date.parse('2026-07-09T12:30:00.000Z'),
        },
      ],
    });

    expect(context).toEqual([
      {
        role: 'user',
        content: '[2026-07-09 09:00 Europe/Warsaw] today my tasks are x, y, and z',
      },
      {
        role: 'user',
        content: '[2026-07-09 14:30 Europe/Warsaw] i finished x',
      },
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

  it('requests durable knowledge items through the knowledge module', async () => {
    mockAgentMemoryDbService.getRecentMemoryChunks.mockResolvedValue([]);

    await AgentContextService.buildContext({
      identityId: 'identity-1',
      threadId: 'thread-1',
      shortTermMemory: [{ role: 'assistant', text: 'Assistant-only state.' }],
    });

    expect(mockAgentKnowledgeService.getContextItems).toHaveBeenCalledWith({
      identityId: 'identity-1',
      shortTermMemory: [{ role: 'assistant', text: 'Assistant-only state.' }],
    });
  });
});

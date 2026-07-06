import type { Chat, Message, Thread } from 'chat';

const mockWaitUntil = jest.fn();
const mockAgentService = {
  generate: jest.fn(),
};
const mockAgentMemoryService = {
  recordMessage: jest.fn(),
  buildContext: jest.fn(),
  compressShortTermMemory: jest.fn(),
};
const mockAgentKnowledgeService = {
  extractImplicitKnowledge: jest.fn(),
};
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

jest.mock('@vercel/functions', () => ({
  waitUntil: mockWaitUntil,
}));

jest.mock('@/app/agent', () => ({
  AgentService: mockAgentService,
}));

jest.mock('@/app/memory', () => ({
  AgentMemoryService: mockAgentMemoryService,
}));

jest.mock('@/app/knowledge', () => ({
  AgentKnowledgeService: mockAgentKnowledgeService,
}));

jest.mock('@/app/memory/context', () => ({
  AgentContextService: {
    contextSourceMessageLimit: 20,
  },
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let BotHandler: typeof import('./bot-handler').BotHandler;

beforeAll(async () => {
  ({ BotHandler } = await import('./bot-handler'));
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  mockAgentMemoryService.recordMessage.mockResolvedValue(undefined);
  mockAgentMemoryService.buildContext.mockResolvedValue([{ role: 'user', content: 'Hello' }]);
  mockAgentMemoryService.compressShortTermMemory.mockResolvedValue(undefined);
  mockAgentKnowledgeService.extractImplicitKnowledge.mockResolvedValue(undefined);
  mockAgentService.generate.mockResolvedValue({ text: 'Hi there.' });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('BotHandler', () => {
  it('handles direct-message callback payloads', async () => {
    const bot = createBot();
    const thread = createThread();
    const message = createMessage();

    BotHandler.configure({ bot });

    await BotHandler.respondToMessage({
      event: 'direct_message',
      thread,
      message,
    });

    expect(bot.transcripts.append).toHaveBeenCalledWith(thread, message);
    expect(bot.transcripts.list).toHaveBeenCalledWith({
      userKey: 'identity-1',
      threadId: 'thread-1',
      limit: 20,
    });
    expect(mockAgentService.generate).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'Hello' }],
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
    });
    expect(thread.startTyping).toHaveBeenCalled();
    expect(getFirstInvocationOrder(thread.startTyping as jest.Mock)).toBeLessThan(
      getFirstInvocationOrder(mockAgentMemoryService.recordMessage),
    );
    expect(thread.post).toHaveBeenCalledWith({ markdown: 'Hi there.' });
    expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Promise));
    expect(mockAgentKnowledgeService.extractImplicitKnowledge).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'Hello',
      assistantMessage: 'Hi there.',
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        messageEvent: 'direct_message',
        threadId: 'thread-1',
        messageId: 'message-1',
      }),
      '[BOT]: message received',
    );
  });

  it('posts user-safe failures without internal error metadata', async () => {
    const bot = createBot();
    const thread = createThread();
    const message = createMessage();

    mockAgentService.generate.mockRejectedValue(new Error('provider exploded'));

    BotHandler.configure({ bot });

    await BotHandler.respondToMessage({
      event: 'direct_message',
      thread,
      message,
    });

    expect(thread.post).toHaveBeenCalledWith({
      markdown: 'I hit a failure while handling that request. Please retry.',
    });
    expect(thread.post).not.toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining('Error code:'),
      }),
    );
  });
});

function getFirstInvocationOrder(mock: jest.Mock) {
  const [order] = mock.mock.invocationCallOrder;

  if (order === undefined) {
    throw new Error('Expected mock to have been called.');
  }

  return order;
}

function createBot() {
  return {
    transcripts: {
      append: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([{ role: 'user', text: 'Hello' }]),
    },
  } as unknown as Chat;
}

function createThread() {
  return {
    id: 'thread-1',
    post: jest.fn().mockResolvedValue(undefined),
    startTyping: jest.fn().mockResolvedValue(undefined),
  } as unknown as Thread & {
    post: jest.Mock;
    startTyping: jest.Mock;
  };
}

function createMessage() {
  return {
    id: 'message-1',
    userKey: 'identity-1',
    text: 'Hello',
    author: {
      userId: 'telegram-user-1',
    },
  } as Message;
}

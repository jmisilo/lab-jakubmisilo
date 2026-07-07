const mockOnDirectMessage = jest.fn();
const mockOnNewMention = jest.fn();
const mockOnSubscribedMessage = jest.fn();
const mockChatLogger: { child: jest.Mock } = {
  child: jest.fn(),
};

mockChatLogger.child.mockReturnValue(mockChatLogger);
const mockBot = {
  onDirectMessage: mockOnDirectMessage,
  onNewMention: mockOnNewMention,
  onSubscribedMessage: mockOnSubscribedMessage,
};
const mockBotHandler = {
  configure: jest.fn(),
  respondToMessage: jest.fn(),
};

jest.mock(
  '@chat-adapter/state-pg',
  () => ({
    createPostgresState: jest.fn(() => ({})),
  }),
  { virtual: true },
);

jest.mock(
  '@chat-adapter/telegram',
  () => ({
    createTelegramAdapter: jest.fn(() => ({})),
  }),
  { virtual: true },
);

jest.mock(
  'chat',
  () => ({
    Chat: jest.fn(() => mockBot),
  }),
  { virtual: true },
);

jest.mock('@/app/bot/bot-handler', () => ({
  BotHandler: mockBotHandler,
}));

jest.mock('@/infrastructure/logger', () => ({
  chatLogger: mockChatLogger,
}));

jest.mock('@/utilities/with-whitelist', () => ({
  withWhitelist:
    (event: string, handler: (thread: unknown, message: unknown, event: string) => Promise<void>) =>
    (thread: unknown, message: unknown) =>
      handler(thread, message, event),
}));

describe('bot composition', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('subscribes new mentions before passing them to the shared bot handler', async () => {
    await import('./index');

    const callback = mockOnNewMention.mock.calls[0][0];
    const thread = {
      subscribe: jest.fn(),
    };
    const message = {
      id: 'message-1',
    };

    await callback(thread, message);

    expect(thread.subscribe).toHaveBeenCalledTimes(1);
    expect(mockBotHandler.respondToMessage).toHaveBeenCalledWith({
      event: 'new_mention',
      thread,
      message,
    });
  });
});

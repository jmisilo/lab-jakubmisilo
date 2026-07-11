jest.unmock('@/infrastructure/logger');

jest.mock('pino', () => {
  const childLogger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  const rootLogger = {
    child: jest.fn(() => childLogger),
  };
  const pino = Object.assign(
    jest.fn(() => rootLogger),
    {
      destination: jest.fn(),
    },
  );

  return {
    __esModule: true,
    default: pino,
    childLogger,
  };
});

describe('chatLogger', () => {
  it('keeps operational metadata without forwarding message content or raw errors', async () => {
    const { chatLogger } = await import('@/infrastructure/logger');
    const { childLogger } = jest.requireMock('pino') as {
      childLogger: { debug: jest.Mock };
    };
    const error = new Error('adapter failed');

    chatLogger.debug(
      'Incoming message',
      {
        adapter: 'telegram',
        error: 'raw provider failure with token=secret',
        handlerCount: 2,
        messageId: 'message-1',
        text: 'private message text',
        threadId: 'thread-1',
        userName: 'private user name',
      },
      error,
    );

    expect(childLogger.debug).toHaveBeenCalledWith(
      {
        adapter: 'telegram',
        handlerCount: 2,
        messageId: 'message-1',
        safeError: {
          adapter: undefined,
          code: undefined,
          name: 'Error',
        },
        threadId: 'thread-1',
      },
      'Incoming message',
    );
  });
});

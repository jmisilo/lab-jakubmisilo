import type { Message, Thread } from 'chat';

const originalAllowedUserIds = process.env.TELEGRAM_ALLOWED_USER_IDS;
const originalAllowedNumbers = process.env.IMESSAGE_ALLOWED_NUMBERS;

describe('withWhitelist', () => {
  afterEach(() => {
    if (originalAllowedUserIds === undefined) {
      delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    } else {
      process.env.TELEGRAM_ALLOWED_USER_IDS = originalAllowedUserIds;
    }
    if (originalAllowedNumbers === undefined) {
      delete process.env.IMESSAGE_ALLOWED_NUMBERS;
    } else {
      process.env.IMESSAGE_ALLOWED_NUMBERS = originalAllowedNumbers;
    }

    jest.resetModules();
  });

  it('allows all users when the whitelist is empty', async () => {
    const { loggerMock, withWhitelist } = await loadWithWhitelist('');
    const handler = jest.fn().mockResolvedValue(undefined);

    await withWhitelist('direct_message', handler)(createThread(), createMessage('user-1'));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thread-1' }),
      expect.objectContaining({ id: 'message-1' }),
      'direct_message',
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('allows users included in TELEGRAM_ALLOWED_USER_IDS', async () => {
    const { loggerMock, withWhitelist } = await loadWithWhitelist('user-1,user-2');
    const handler = jest.fn().mockResolvedValue(undefined);

    await withWhitelist('subscribed_message', handler)(createThread(), createMessage('user-2'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thread-1' }),
      expect.objectContaining({ id: 'message-1' }),
      'subscribed_message',
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('blocks users missing from TELEGRAM_ALLOWED_USER_IDS', async () => {
    const { loggerMock, withWhitelist } = await loadWithWhitelist('user-1,user-2');
    const handler = jest.fn().mockResolvedValue(undefined);

    await withWhitelist('new_mention', handler)(createThread(), createMessage('user-3'));

    expect(handler).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      {
        messageEvent: 'new_mention',
        threadId: 'thread-1',
        messageId: 'message-1',
        authorId: 'user-3',
        allowedUserCount: 2,
      },
      '[TELEGRAM_AGENT]: message ignored because author is not allowlisted',
    );
  });

  it('allows numbers included in IMESSAGE_ALLOWED_NUMBERS', async () => {
    const { loggerMock, withWhitelist } = await loadWithWhitelist(
      'telegram-user-1',
      '+48123456789,+48987654321',
    );
    const handler = jest.fn().mockResolvedValue(undefined);

    await withWhitelist('direct_message', handler)(
      createThread('imessage'),
      createMessage('+48123456789'),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('allows all iMessage numbers when IMESSAGE_ALLOWED_NUMBERS is empty', async () => {
    const { loggerMock, withWhitelist } = await loadWithWhitelist('telegram-user-1');
    const handler = jest.fn().mockResolvedValue(undefined);

    await withWhitelist('direct_message', handler)(
      createThread('imessage'),
      createMessage('+48999999999'),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('blocks numbers missing from IMESSAGE_ALLOWED_NUMBERS', async () => {
    const { loggerMock, withWhitelist } = await loadWithWhitelist('', '+48123456789');
    const handler = jest.fn().mockResolvedValue(undefined);

    await withWhitelist('direct_message', handler)(
      createThread('imessage'),
      createMessage('+48999999999'),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      {
        messageEvent: 'direct_message',
        threadId: 'thread-1',
        messageId: 'message-1',
        authorId: '+48999999999',
        allowedUserCount: 1,
      },
      '[IMESSAGE_AGENT]: message ignored because author is not allowlisted',
    );
  });
});

const loadWithWhitelist = async (allowedUserIds: string, allowedNumbers = '') => {
  process.env.TELEGRAM_ALLOWED_USER_IDS = allowedUserIds;
  process.env.IMESSAGE_ALLOWED_NUMBERS = allowedNumbers;
  jest.resetModules();

  const [{ withWhitelist }, { logger }] = await Promise.all([
    import('@/utilities/with-whitelist'),
    import('@/infrastructure/logger'),
  ]);
  const loggerMock = logger as unknown as { warn: jest.Mock };
  loggerMock.warn.mockClear();

  return { loggerMock, withWhitelist };
};

const createThread = (adapterName = 'telegram') =>
  ({
    id: 'thread-1',
    adapter: { name: adapterName },
  }) as Thread;

const createMessage = (userId: string) =>
  ({
    id: 'message-1',
    author: {
      userId,
    },
  }) as Message;

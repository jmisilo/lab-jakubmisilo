import type { Message, Thread } from 'chat';

import { logger } from '@/infrastructure/logger';

type TelegramMessageHandler = (thread: Thread, message: Message) => Promise<void>;

const TELEGRAM_ALLOWED_USER_IDS = new Set(
  (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean),
);

export const withWhitelist =
  (event: string, handler: TelegramMessageHandler): TelegramMessageHandler =>
  async (thread, message) => {
    if (
      TELEGRAM_ALLOWED_USER_IDS.has(message.author.userId) ||
      TELEGRAM_ALLOWED_USER_IDS.size === 0
    ) {
      await handler(thread, message);

      return;
    }

    logger.warn(
      {
        messageEvent: event,
        threadId: thread.id,
        messageId: message.id,
        authorId: message.author.userId,
        allowedUserCount: TELEGRAM_ALLOWED_USER_IDS.size,
      },
      '[TELEGRAM_AGENT]: message ignored because author is not allowlisted',
    );
  };

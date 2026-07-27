import type { Message, Thread } from 'chat';

import { logger } from '@/infrastructure/logger';

const TELEGRAM_ALLOWED_USER_IDS = new Set(
  (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean),
);
const IMESSAGE_ALLOWED_NUMBERS = new Set(
  (process.env.IMESSAGE_ALLOWED_NUMBERS ?? '')
    .split(',')
    .map((phoneNumber) => phoneNumber.trim())
    .filter(Boolean),
);

export const withWhitelist =
  <TEvent extends string>(
    event: TEvent,
    handler: WhitelistedMessageHandlerWithEvent<TEvent>,
  ): WhitelistedMessageHandler =>
  async (thread, message) => {
    if (
      thread.adapter.name === 'telegram' &&
      TELEGRAM_ALLOWED_USER_IDS.size > 0 &&
      !TELEGRAM_ALLOWED_USER_IDS.has(message.author.userId)
    ) {
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
      return;
    }

    if (
      thread.adapter.name === 'imessage' &&
      IMESSAGE_ALLOWED_NUMBERS.size > 0 &&
      !IMESSAGE_ALLOWED_NUMBERS.has(message.author.userId)
    ) {
      logger.warn(
        {
          messageEvent: event,
          threadId: thread.id,
          messageId: message.id,
          authorId: message.author.userId,
          allowedUserCount: IMESSAGE_ALLOWED_NUMBERS.size,
        },
        '[IMESSAGE_AGENT]: message ignored because author is not allowlisted',
      );
      return;
    }

    await handler(thread, message, event);
  };

type WhitelistedMessageHandler = (thread: Thread, message: Message) => Promise<void>;
type WhitelistedMessageHandlerWithEvent<TEvent extends string> = (
  thread: Thread,
  message: Message,
  event: TEvent,
) => Promise<void>;

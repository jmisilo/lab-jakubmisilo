import type { Message, Thread } from 'chat';

import { createPostgresState } from '@chat-adapter/state-pg';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { waitUntil } from '@vercel/functions';
import { Chat } from 'chat';

import { AIAgentService } from '@/app/agent';
import { AgentMemoryService } from '@/app/memory';
import { AgentContextService } from '@/app/memory/context';
import { chatLogger, logger } from '@/infrastructure/logger';
import { withWhitelist } from '@/utilities/with-whitelist';

const TYPING_INDICATOR_REFRESH_MS = 3_000;
const EMPTY_AGENT_RESPONSE_ERROR_CODE = 'EMPTY_AGENT_RESPONSE';

class UserVisibleAgentError extends Error {
  constructor(
    message: string,
    readonly details: { code: string; reason: string },
  ) {
    super(message);
    this.name = 'UserVisibleAgentError';
  }
}

export const bot = new Chat({
  userName: process.env.TELEGRAM_BOT_USERNAME ?? 'labjm_assistant_bot',
  adapters: {
    telegram: createTelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      secretToken: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
    }),
  },
  state: createPostgresState({
    url: process.env.DATABASE_URL,
    keyPrefix: 'agent',
    logger: chatLogger.child('state-pg'),
  }),
  /** @todo temp solution, provide proper solve */
  identity: ({ author }) => author.userId,
  transcripts: {
    retention: '30d',
    maxPerUser: 200,
  },
  threadHistory: {
    maxMessages: 20,
    ttlMs: 1000 * 60 * 60 * 24 * 7,
  },
  logger: chatLogger,
  concurrency: 'queue',
});

bot.onDirectMessage(
  withWhitelist('direct_message', async (thread, message) => {
    await respondToMessage({ event: 'direct_message', thread, message });
  }),
);

bot.onNewMention(
  withWhitelist('new_mention', async (thread, message) => {
    await thread.subscribe();

    await respondToMessage({ event: 'new_mention', thread, message });
  }),
);

bot.onSubscribedMessage(
  withWhitelist('subscribed_message', async (thread, message) => {
    await respondToMessage({ event: 'subscribed_message', thread, message });
  }),
);

const respondToMessage = async ({
  event,
  thread,
  message,
}: {
  event: string;
  thread: Thread;
  message: Message;
}) => {
  logger.info(
    {
      messageEvent: event,
      threadId: thread.id,
      messageId: message.id,
      authorId: message.author.userId,
    },
    '[TELEGRAM_AGENT]: message received',
  );

  try {
    logger.debug(
      {
        threadId: thread.id,
        messageId: message.id,
      },
      '[TELEGRAM_AGENT]: agent thinking started',
    );

    /** @todo temp solution, provide proper solve */
    const identityId = message.userKey ?? message.author.userId;

    await Promise.all([
      bot.transcripts.append(thread, message),
      AgentMemoryService.recordMessage({
        identityId,
        threadId: thread.id,
        role: 'user',
        content: message.text,
        sourceMessageId: message.id,
      }),
    ]);

    const shortTermMemory = await bot.transcripts.list({
      userKey: identityId,
      threadId: thread.id,
      limit: AgentContextService.contextSourceMessageLimit,
    });
    const contextMessages = await AgentMemoryService.buildContext({
      identityId,
      threadId: thread.id,
      shortTermMemory,
    });

    logger.debug(
      {
        threadId: thread.id,
        messageId: message.id,
        contextMessageCount: contextMessages.length,
      },
      '[TELEGRAM_AGENT]: context prepared',
    );

    const result = await withTypingIndicator(thread, () =>
      AIAgentService.generate({
        messages: contextMessages,
        identityId,
        threadId: thread.id,
        sourceMessageId: message.id,
      }),
    );

    logger.debug(
      {
        threadId: thread.id,
        messageId: message.id,
        text: result.text,
      },
      '[TELEGRAM_AGENT]: model output generated',
    );

    const responseText = result.text.trim();

    if (!responseText) {
      throw new UserVisibleAgentError('Agent generated an empty response', {
        code: EMPTY_AGENT_RESPONSE_ERROR_CODE,
        reason:
          'The model returned an empty response after tool calls, so Telegram would reject the message.',
      });
    }

    await thread.post({ markdown: responseText });

    await Promise.all([
      bot.transcripts.append(
        thread,
        { role: 'assistant', text: responseText },
        { userKey: identityId },
      ),
      AgentMemoryService.recordMessage({
        identityId,
        threadId: thread.id,
        role: 'assistant',
        content: responseText,
      }),
    ]);

    logger.info(
      {
        threadId: thread.id,
        sourceMessageId: message.id,
      },
      '[TELEGRAM_AGENT]: message sent',
    );

    waitUntil(
      AgentMemoryService.compressShortTermMemory({
        identityId,
        threadId: thread.id,
      }),
    );
  } catch (error) {
    const failureDetails = getUserFacingFailureDetails(error);

    logger.error(
      {
        threadId: thread.id,
        sourceMessageId: message.id,
        error,
        userFacingCode: failureDetails.code,
        userFacingReason: failureDetails.reason,
      },
      '[TELEGRAM_AGENT]: message failed',
    );

    await postFailureMessage({ thread, sourceMessageId: message.id, failureDetails });
  }
};

const postFailureMessage = async ({
  thread,
  sourceMessageId,
  failureDetails,
}: {
  thread: Thread;
  sourceMessageId: string;
  failureDetails: { code: string; reason: string; name?: string };
}) => {
  try {
    await thread.post({
      markdown: '⚠️ I hit a failure while handling that request. Please retry.',
    });

    logger.info(
      {
        threadId: thread.id,
        sourceMessageId,
        userFacingCode: failureDetails.code,
        userFacingReason: failureDetails.reason,
        userFacingName: failureDetails.name,
      },
      '[TELEGRAM_AGENT]: failure message sent',
    );
  } catch (postError) {
    logger.error(
      {
        threadId: thread.id,
        sourceMessageId,
        originalFailureCode: failureDetails.code,
        error: postError,
      },
      '[TELEGRAM_AGENT]: failure message failed',
    );
  }
};

const getUserFacingFailureDetails = (
  error: unknown,
): { code: string; reason: string; name?: string } => {
  if (error instanceof UserVisibleAgentError) {
    return {
      code: error.details.code,
      reason: error.details.reason,
      name: error.name,
    };
  }

  const code = getErrorField(error, 'code') ?? 'AGENT_MESSAGE_FAILED';
  const name = getErrorField(error, 'name') ?? (error instanceof Error ? error.name : undefined);
  const message = error instanceof Error ? error.message : undefined;
  const adapter = getErrorField(error, 'adapter');
  const adapterContext = adapter ? `${adapter} adapter failed` : 'The agent failed';
  const reason = message?.trim() ? `${adapterContext}: ${message}` : `${adapterContext}.`;

  return {
    code,
    reason,
    name,
  };
};

const getErrorField = (error: unknown, field: string) => {
  if (!error || typeof error !== 'object' || !(field in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[field];

  return typeof value === 'string' && value.trim() ? value : undefined;
};

const withTypingIndicator = async <T>(thread: Thread, operation: () => Promise<T>): Promise<T> => {
  startTypingWithTimeout(thread, 'typing_indicator_initial_timeout');

  const interval = setInterval(() => {
    startTypingWithTimeout(thread, 'typing_indicator_refresh_timeout');
  }, TYPING_INDICATOR_REFRESH_MS);

  try {
    return await operation();
  } finally {
    clearInterval(interval);
  }
};

const startTypingWithTimeout = (thread: Thread, timeoutEvent: string): void => {
  void Promise.race([
    thread.startTyping(),
    sleep(1_500).then(() => {
      throw new Error(timeoutEvent);
    }),
  ]).catch((error: unknown) => {
    logger.warn(
      {
        threadId: thread.id,
        error,
      },
      '[TELEGRAM_AGENT]: typing indicator failed',
    );
  });
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

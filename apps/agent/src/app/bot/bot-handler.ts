import type { UserFacingFailure } from '@/infrastructure/errors';
import type { Chat, Message, Thread } from 'chat';

import { waitUntil } from '@vercel/functions';

import { AgentService } from '@/app/agent';
import { AgentKnowledgeService } from '@/app/knowledge';
import { AgentMemoryService } from '@/app/memory';
import { AgentContextService } from '@/app/memory/context';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const TYPING_INDICATOR_REFRESH_MS = 3_000;
const TYPING_INDICATOR_TIMEOUT_MS = 1_500;

type BotHandlerConfig = {
  bot: Chat;
};

type RespondToMessageInput = {
  event: string;
  thread: Thread;
  message: Message;
};

export class BotHandler {
  static #bot: Chat | null = null;

  static configure({ bot }: BotHandlerConfig) {
    this.#bot = bot;
  }

  static async respondToMessage({ event, thread, message }: RespondToMessageInput) {
    logger.info(
      {
        messageEvent: event,
        threadId: thread.id,
        messageId: message.id,
        authorId: message.author.userId,
      },
      '[BOT]: message received',
    );

    await this.#withTypingIndicator({
      thread,
      operation: async () => {
        try {
          logger.debug(
            {
              threadId: thread.id,
              messageId: message.id,
            },
            '[BOT]: agent thinking started',
          );

          const bot = this.#getBot();
          const identityId = this.#resolveIdentityId(message);

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
            '[BOT]: context prepared',
          );

          const result = await AgentService.generate({
            messages: contextMessages,
            identityId,
            threadId: thread.id,
            sourceMessageId: message.id,
          });

          logger.debug(
            {
              threadId: thread.id,
              messageId: message.id,
              text: result.text,
            },
            '[BOT]: model output generated',
          );

          const responseText = this.#resolveResponseText({
            text: result.text,
            threadId: thread.id,
            sourceMessageId: message.id,
          });

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
            '[BOT]: message sent',
          );

          waitUntil(
            AgentMemoryService.compressShortTermMemory({
              identityId,
              threadId: thread.id,
            }),
          );
          waitUntil(
            AgentKnowledgeService.extractImplicitKnowledge({
              identityId,
              threadId: thread.id,
              sourceMessageId: message.id,
              userMessage: message.text,
              assistantMessage: responseText,
            }),
          );
        } catch (error) {
          const failure = ErrorService.toUserFacingFailure(error, {
            fallbackCode: AppErrorCode.BOT_MESSAGE_FAILED,
            fallbackMessage: 'I hit a failure while handling that request.',
          });

          logger.error(
            {
              threadId: thread.id,
              sourceMessageId: message.id,
              error,
              safeError: ErrorService.toSafeLog(error),
              userFacingCode: failure.code,
              userFacingMessage: failure.message,
              retryable: failure.retryable,
            },
            '[BOT]: message failed',
          );

          await this.#postFailureMessage({ thread, sourceMessageId: message.id, failure });
        }
      },
    });
  }

  static #getBot() {
    if (!this.#bot) {
      throw new AppError({
        code: AppErrorCode.BOT_HANDLER_NOT_CONFIGURED,
        message: 'BotHandler used before it was configured with a Chat instance.',
        retryable: false,
        userMessage: 'The assistant is not configured correctly.',
      });
    }

    return this.#bot;
  }

  static #resolveIdentityId(message: Message) {
    return message.userKey ?? message.author.userId;
  }

  static #resolveResponseText({
    text,
    threadId,
    sourceMessageId,
  }: {
    text: string;
    threadId: string;
    sourceMessageId: string;
  }) {
    const responseText = text.trim();

    if (responseText) {
      return responseText;
    }

    throw new AppError({
      code: AppErrorCode.BOT_EMPTY_RESPONSE,
      message: 'Assistant generated an empty response.',
      context: {
        threadId,
        sourceMessageId,
      },
      retryable: true,
      userMessage: 'I generated an empty response, so Telegram could not send it.',
    });
  }

  static async #postFailureMessage({
    thread,
    sourceMessageId,
    failure,
  }: {
    thread: Thread;
    sourceMessageId: string;
    failure: UserFacingFailure;
  }) {
    const retryText = failure.retryable ? ' Please retry.' : '';

    try {
      await thread.post({
        markdown: `${failure.message}${retryText}\n\nError code: \`${failure.code}\``,
      });

      logger.info(
        {
          threadId: thread.id,
          sourceMessageId,
          userFacingCode: failure.code,
          userFacingMessage: failure.message,
          retryable: failure.retryable,
        },
        '[BOT]: failure message sent',
      );
    } catch (postError) {
      logger.error(
        {
          threadId: thread.id,
          sourceMessageId,
          originalFailureCode: failure.code,
          error: postError,
          safeError: ErrorService.toSafeLog(postError),
        },
        '[BOT]: failure message failed',
      );
    }
  }

  static async #withTypingIndicator<T>({
    thread,
    operation,
  }: {
    thread: Thread;
    operation: () => Promise<T>;
  }) {
    this.#startTypingWithTimeout({ thread, timeoutEvent: 'initial' });

    const interval = setInterval(() => {
      this.#startTypingWithTimeout({ thread, timeoutEvent: 'refresh' });
    }, TYPING_INDICATOR_REFRESH_MS);

    try {
      return await operation();
    } finally {
      clearInterval(interval);
    }
  }

  static #startTypingWithTimeout({
    thread,
    timeoutEvent,
  }: {
    thread: Thread;
    timeoutEvent: 'initial' | 'refresh';
  }) {
    void Promise.race([
      thread.startTyping(),
      this.#rejectAfterTypingTimeout({ threadId: thread.id, timeoutEvent }),
    ]).catch((error: unknown) => {
      logger.warn(
        {
          threadId: thread.id,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[BOT]: typing indicator failed',
      );
    });
  }

  static async #rejectAfterTypingTimeout({
    threadId,
    timeoutEvent,
  }: {
    threadId: string;
    timeoutEvent: 'initial' | 'refresh';
  }) {
    await this.#sleep(TYPING_INDICATOR_TIMEOUT_MS);

    throw AppError.timeout({
      code: AppErrorCode.BOT_TYPING_INDICATOR_TIMEOUT,
      message: 'Chat typing indicator timed out.',
      context: {
        threadId,
        timeoutEvent,
      },
      timeoutMs: TYPING_INDICATOR_TIMEOUT_MS,
    });
  }

  static #sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

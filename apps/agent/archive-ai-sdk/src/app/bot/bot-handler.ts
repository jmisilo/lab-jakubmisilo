import type { UserFacingFailure } from '@/infrastructure/errors';
import type { BlooioProvider } from '@imessage-sdk/blooio';
import type { IMessageAdapter } from '@imessage-sdk/chat-adapter';
import type { Chat, Message, Thread } from 'chat';

import { waitUntil } from '@vercel/functions';

import { AgentService } from '@/app/agent';
import { AgentAttachmentService } from '@/app/attachments';
import { AgentKnowledgeService } from '@/app/knowledge';
import { AgentMemoryService } from '@/app/memory';
import { AgentContextService } from '@/app/memory/context';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';
import { AgentObservabilityService } from '@/infrastructure/observability';

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

    await this.#withMessageLifecycle({
      thread,
      operation: async () => {
        try {
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
          const messages = await AgentAttachmentService.addToLatestUserMessage({
            messages: contextMessages,
            attachments: message.attachments,
          });

          const result = await AgentService.generate({
            messages,
            identityId,
            threadId: thread.id,
            sourceMessageId: message.id,
          });

          const responseText = this.#resolveResponseText({
            text: result.text,
            threadId: thread.id,
            sourceMessageId: message.id,
          });

          await thread.post({ raw: responseText });

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
              safeError: ErrorService.toSafeLog(error),
              userFacingCode: failure.code,
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
      userMessage: 'I generated an empty response, so iMessage could not send it.',
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
        raw: `${failure.message}${retryText}`,
      });

      logger.info(
        {
          threadId: thread.id,
          sourceMessageId,
          userFacingCode: failure.code,
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
          safeError: ErrorService.toSafeLog(postError),
        },
        '[BOT]: failure message failed',
      );
    }
  }

  static async #withMessageLifecycle<T>({
    thread,
    operation,
  }: {
    thread: Thread;
    operation: () => Promise<T>;
  }) {
    void this.#initMessage(thread);

    try {
      return await operation();
    } finally {
      waitUntil(AgentObservabilityService.flush());
    }
  }

  static async #initMessage(thread: Thread) {
    try {
      if (thread.adapter.name === 'imessage') {
        const adapter = thread.adapter as IMessageAdapter<BlooioProvider>;

        await adapter.markRead(thread.id);
      }

      await thread.startTyping();
    } catch (error) {
      logger.warn(
        {
          threadId: thread.id,
          safeError: ErrorService.toSafeLog(error),
        },
        '[BOT]: message initialization failed',
      );
    }
  }
}

type BotHandlerConfig = {
  bot: Chat;
};

type RespondToMessageInput = {
  event: string;
  thread: Thread;
  message: Message;
};

import { createMemoryState } from "@chat-adapter/state-memory";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { Chat, type Message, type Thread } from "chat";
import { toAiMessages } from "chat/ai";
import type { ModelMessage } from "ai";

import { AIAgentService } from "@/app/agent";
import { chatLogger, logger } from "@/infrastructure/logger";

const TYPING_INDICATOR_REFRESH_MS = 3_000;
const MAX_CONTEXT_MESSAGES = 20;

export const bot = new Chat({
  userName: process.env.TELEGRAM_BOT_USERNAME ?? "labjm_assistant_bot",
  adapters: {
    telegram: createTelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      secretToken: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
    }),
  },
  state: createMemoryState(),
  threadHistory: {
    maxMessages: 20,
    ttlMs: 1000 * 60 * 60 * 24 * 7,
  },
  logger: chatLogger,
  concurrency: "queue",
});

bot.onDirectMessage(async (thread, message) => {
  await respondToMessage({ event: "direct_message", thread, message });
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await respondToMessage({ event: "new_mention", thread, message });
});

bot.onSubscribedMessage(async (thread, message) => {
  await respondToMessage({ event: "subscribed_message", thread, message });
});

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
      text: message.text,
    },
    "[TELEGRAM_AGENT]: message received",
  );

  try {
    logger.info(
      {
        threadId: thread.id,
        messageId: message.id,
      },
      "[TELEGRAM_AGENT]: agent thinking started",
    );

    const contextMessages = await getContextMessages(thread);

    logger.info(
      {
        threadId: thread.id,
        messageId: message.id,
        contextMessageCount: contextMessages.length,
      },
      "[TELEGRAM_AGENT]: context prepared",
    );

    const result = await withTypingIndicator(thread, () =>
      AIAgentService.generate({ messages: contextMessages }),
    );

    logger.info(
      {
        threadId: thread.id,
        messageId: message.id,
        text: result.text,
      },
      "[TELEGRAM_AGENT]: model output generated",
    );

    await thread.post(result.text);

    logger.info(
      {
        threadId: thread.id,
        sourceMessageId: message.id,
      },
      "[TELEGRAM_AGENT]: message sent",
    );
  } catch (error) {
    logger.error(
      {
        threadId: thread.id,
        sourceMessageId: message.id,
        error,
      },
      "[TELEGRAM_AGENT]: message failed",
    );

    throw error;
  }
};

const withTypingIndicator = async <T>(
  thread: Thread,
  operation: () => Promise<T>,
): Promise<T> => {
  startTypingWithTimeout(thread, "typing_indicator_initial_timeout");

  const interval = setInterval(() => {
    startTypingWithTimeout(thread, "typing_indicator_refresh_timeout");
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
      "[TELEGRAM_AGENT]: typing indicator failed",
    );
  });
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getContextMessages = async (thread: Thread): Promise<ModelMessage[]> => {
  const messages: Message[] = [];

  for await (const message of thread.allMessages) {
    messages.push(message);
  }

  const recentMessages = messages.slice(-MAX_CONTEXT_MESSAGES);
  const aiMessages = await toAiMessages(recentMessages, {
    includeNames: true,
    onUnsupportedAttachment: (attachment, message) => {
      logger.warn(
        {
          threadId: thread.id,
          messageId: message.id,
          attachmentType: attachment.type,
          attachmentName: attachment.name,
        },
        "[TELEGRAM_AGENT]: skipped unsupported attachment in context",
      );
    },
  });

  return aiMessages as ModelMessage[];
};

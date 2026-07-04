import { createPostgresState } from '@chat-adapter/state-pg';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { Chat } from 'chat';

import { BotHandler } from '@/app/bot/bot-handler';
import { chatLogger } from '@/infrastructure/logger';
import { withWhitelist } from '@/utilities/with-whitelist';

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
  /** @todo replace platform identity with internal user resolution. */
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

BotHandler.configure({ bot });

bot.onDirectMessage(withWhitelist('direct_message', BotHandler.respondToDirectMessage));
bot.onNewMention(withWhitelist('new_mention', BotHandler.respondToNewMention));
bot.onSubscribedMessage(withWhitelist('subscribed_message', BotHandler.respondToSubscribedMessage));

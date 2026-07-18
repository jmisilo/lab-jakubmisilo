import { createPostgresState } from '@chat-adapter/state-pg';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { photon } from '@imessage-sdk/photon';
import { Chat } from 'chat';

import { BotHandler } from '@/app/bot/bot-handler';
import { chatLogger } from '@/infrastructure/logger';
import { withWhitelist } from '@/utilities/with-whitelist';

export const bot = new Chat({
  userName: 'labjm_assistant_bot',
  adapters: {
    imessage: createIMessageAdapter({
      provider: photon(),
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

bot.onDirectMessage(
  withWhitelist('direct_message', (thread, message, event) =>
    BotHandler.respondToMessage({
      event,
      thread,
      message,
    }),
  ),
);
bot.onNewMention(
  withWhitelist('new_mention', async (thread, message, event) => {
    await thread.subscribe();

    await BotHandler.respondToMessage({
      event,
      thread,
      message,
    });
  }),
);
bot.onSubscribedMessage(
  withWhitelist('subscribed_message', (thread, message, event) =>
    BotHandler.respondToMessage({
      event,
      thread,
      message,
    }),
  ),
);

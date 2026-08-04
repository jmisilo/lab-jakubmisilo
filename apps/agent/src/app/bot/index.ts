import { BotHandler } from './bot-handler';
import { chat, chatState, initializeBot } from './transport';

chat.onDirectMessage((thread, message) =>
  BotHandler.respondToMessage({
    event: 'direct',
    thread,
    message,
  }),
);

chat.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await BotHandler.respondToMessage({
    event: 'mention',
    thread,
    message,
  });
});

chat.onSubscribedMessage((thread, message) =>
  BotHandler.respondToMessage({
    event: 'subscribed',
    thread,
    message,
  }),
);

export { chat, chatState, initializeBot };

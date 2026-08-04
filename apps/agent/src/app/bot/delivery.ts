import { logger } from '../../infrastructure/logger';
import { normalizeIMessagePost } from './imessage';
import { chat, initializeBot } from './transport';

/** Post through the singleton Chat SDK transport boundary. */
export async function postToThread(threadId: string, text: string) {
  await initializeBot();
  await chat.thread(threadId).post(normalizeIMessagePost(text));
  logger.info('Outbound iMessage posted', { threadId });
}

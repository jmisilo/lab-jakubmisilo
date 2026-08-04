import type { AgentTraceContext } from './feedback';
import { logger } from '../../infrastructure/logger';
import { trackAgentResponse } from './feedback';
import { normalizeIMessagePost } from './imessage';
import { chat } from './transport';

/** Post through the singleton Chat SDK transport boundary. */
export async function postToThread(
  threadId: string,
  text: string,
  traceContext?: AgentTraceContext,
) {
  // Webhooks initialize Chat lazily. Scheduled delivery is outside a webhook,
  // so use Chat's native idempotent lifecycle method before posting.
  await chat.initialize();
  const sent = await chat.thread(threadId).post(normalizeIMessagePost(text));

  if (traceContext) {
    await trackAgentResponse(sent.id, traceContext);
  }

  logger.info('Outbound iMessage posted', { threadId });
}

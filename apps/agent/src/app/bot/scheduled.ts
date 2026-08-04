import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';

import { logger } from '../../infrastructure/logger';
import { agent } from '../agent';
import { postToThread } from './delivery';
import { extractResponseText } from './response';
import { initializeBot } from './transport';

export async function runScheduled({
  resourceId,
  threadId,
  prompt,
  timeZone = 'Europe/Warsaw',
  source,
  deliveryId,
}: {
  resourceId: string;
  threadId: string;
  prompt: string;
  timeZone?: string;
  source: 'one-time-schedule' | 'recurring-schedule';
  deliveryId?: string;
}) {
  await initializeBot();

  logger.info('Scheduled agent turn started', {
    deliveryId,
    resourceId,
    source,
    threadId,
  });

  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, resourceId);
  requestContext.set(MASTRA_THREAD_ID_KEY, threadId);
  requestContext.set('timeZone', timeZone);
  requestContext.set('channel', {
    platform: 'imessage',
    eventType: source,
    userId: resourceId,
    threadId,
    messageId: deliveryId,
  });

  const result = await agent.generate(
    [
      {
        role: 'user',
        content: `This is a scheduled reminder. Deliver it directly and concisely to the user:\n\n${prompt}`,
      },
    ],
    {
      memory: { resource: resourceId, thread: threadId },
      requestContext,
    },
  );
  const text = extractResponseText(result as never);

  await postToThread(threadId, text);

  logger.info('Scheduled agent turn completed', {
    deliveryId,
    resourceId,
    source,
    threadId,
  });

  return text;
}

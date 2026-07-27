import type { RequestContext } from '@mastra/core/request-context';

import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { z } from 'zod';

export const AgentRequestContextSchema = z.looseObject({
  [MASTRA_RESOURCE_ID_KEY]: z.string().min(1).optional(),
  [MASTRA_THREAD_ID_KEY]: z.string().min(1).optional(),
  timeZone: z.string().min(1).optional(),
  channel: z
    .looseObject({
      platform: z.string(),
      eventType: z.string(),
      userId: z.string(),
      threadId: z.string().optional(),
    })
    .optional(),
});

export function resolveIdentityId(requestContext?: RequestContext) {
  const resourceId = requestContext?.get(MASTRA_RESOURCE_ID_KEY);

  if (typeof resourceId === 'string' && resourceId.trim()) {
    return resourceId;
  }

  const channel = requestContext?.get('channel');

  if (
    channel &&
    typeof channel === 'object' &&
    'userId' in channel &&
    typeof channel.userId === 'string'
  ) {
    return channel.userId;
  }

  return undefined;
}

export function resolveTimeZone(requestContext?: RequestContext) {
  const timeZone = requestContext?.get('timeZone');

  return typeof timeZone === 'string' && timeZone.trim() ? timeZone : 'Europe/Warsaw';
}

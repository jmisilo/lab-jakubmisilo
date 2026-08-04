import type { RequestContext } from '@mastra/core/request-context';

import { createHash } from 'node:crypto';

/**
 * Gives one inbound scheduling mutation a stable identity across model retries.
 * This is domain idempotency, not provider-level message idempotency.
 */
export function createSchedulingIdempotencyKey({
  requestContext,
  resourceId,
  action,
}: {
  requestContext?: RequestContext;
  resourceId: string;
  action: 'create_one_time' | 'create_recurring';
}) {
  const channel = requestContext?.get('channel');
  const messageId =
    channel && typeof channel === 'object' && 'messageId' in channel
      ? channel.messageId
      : undefined;

  if (typeof messageId !== 'string' || !messageId.trim()) {
    return undefined;
  }

  return createHash('sha256')
    .update(
      JSON.stringify({
        namespace: 'schedule-create-v2',
        messageId,
        action,
        resourceId,
      }),
    )
    .digest('hex');
}

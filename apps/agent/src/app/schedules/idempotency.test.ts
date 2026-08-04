import { MASTRA_RESOURCE_ID_KEY, RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';

import { createSchedulingIdempotencyKey } from './idempotency';

describe('scheduling domain idempotency', () => {
  it('is stable across model retries for the same inbound message', () => {
    const requestContext = new RequestContext();
    requestContext.set(MASTRA_RESOURCE_ID_KEY, 'user-1');
    requestContext.set('channel', { messageId: 'message-1' });

    expect(
      createSchedulingIdempotencyKey({
        requestContext,
        resourceId: 'user-1',
        action: 'create_one_time',
      }),
    ).toBe(
      createSchedulingIdempotencyKey({
        requestContext,
        resourceId: 'user-1',
        action: 'create_one_time',
      }),
    );
  });

  it('keeps different scheduling actions independent', () => {
    const requestContext = new RequestContext();
    requestContext.set('channel', { messageId: 'message-1' });

    expect(
      createSchedulingIdempotencyKey({
        requestContext,
        resourceId: 'user-1',
        action: 'create_one_time',
      }),
    ).not.toBe(
      createSchedulingIdempotencyKey({
        requestContext,
        resourceId: 'user-1',
        action: 'create_recurring',
      }),
    );
  });
});

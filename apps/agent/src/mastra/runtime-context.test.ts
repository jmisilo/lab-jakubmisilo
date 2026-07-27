import { MASTRA_RESOURCE_ID_KEY, RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';

import { AgentRequestContextSchema, resolveIdentityId, resolveTimeZone } from './runtime-context';

describe('agent runtime context', () => {
  it('uses the stable Mastra resource as the knowledge identity', () => {
    const requestContext = new RequestContext();
    requestContext.set(MASTRA_RESOURCE_ID_KEY, 'imessage:+48123456789');
    requestContext.set('channel', {
      platform: 'imessage',
      eventType: 'direct_message',
      userId: '+48123456789',
    });

    expect(resolveIdentityId(requestContext)).toBe('imessage:+48123456789');
  });

  it('falls back to the channel user when no resource is available', () => {
    const requestContext = new RequestContext();
    requestContext.set('channel', {
      platform: 'imessage',
      eventType: 'direct_message',
      userId: '+48123456789',
    });

    expect(resolveIdentityId(requestContext)).toBe('+48123456789');
  });

  it('defaults the timezone to Warsaw and validates channel context', () => {
    const result = AgentRequestContextSchema.safeParse({
      channel: {
        platform: 'imessage',
        eventType: 'direct_message',
        userId: '+48123456789',
      },
    });

    expect(result.success).toBe(true);
    expect(resolveTimeZone(new RequestContext())).toBe('Europe/Warsaw');
  });
});

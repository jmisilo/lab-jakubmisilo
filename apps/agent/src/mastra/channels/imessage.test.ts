import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { photon } from '@imessage-sdk/photon';
import { describe, expect, it, vi } from 'vitest';

import { configurePlainTextIMessageOutput, normalizeIMessagePost } from './imessage';

describe('normalizeIMessagePost', () => {
  it('decorates an adapter created by createIMessageAdapter', async () => {
    const adapter = createIMessageAdapter({
      provider: photon({
        projectId: 'test-project',
        projectSecret: 'test-secret',
      }),
    });
    const postMessage = vi.spyOn(adapter, 'postMessage').mockResolvedValue({} as never);

    configurePlainTextIMessageOutput(adapter);
    await adapter.postMessage('imessage:test-thread', '**Hello**');

    expect(postMessage).toHaveBeenCalledWith('imessage:test-thread', { raw: 'Hello' });
  });

  it('converts generated Markdown into iMessage-safe plain text', () => {
    expect(
      normalizeIMessagePost(
        '## Today\n\n**Priority:** call the venue.\n\n- Gym at 18:00\n- Send the brief',
      ),
    ).toEqual({
      raw: 'Today\n\nPriority: call the venue.\n\nGym at 18:00\nSend the brief',
    });
  });

  it('preserves link destinations while removing Markdown syntax', () => {
    expect(normalizeIMessagePost('[Connect Google](https://example.com/connect)')).toEqual({
      raw: 'Connect Google: https://example.com/connect',
    });
  });

  it('leaves structured posts unchanged', () => {
    const postable = { raw: 'Already formatted' };

    expect(normalizeIMessagePost(postable)).toBe(postable);
  });
});

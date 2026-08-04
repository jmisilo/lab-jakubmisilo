import { describe, expect, it } from 'vitest';

import { normalizeIMessagePost } from './imessage';

describe('normalizeIMessagePost', () => {
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

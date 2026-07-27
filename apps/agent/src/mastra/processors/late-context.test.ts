import { describe, expect, it } from 'vitest';

import { insertContextBeforeLatestMessage } from './late-context';

describe('insertContextBeforeLatestMessage', () => {
  it('preserves the stable prefix and inserts dynamic context before the latest message', () => {
    const prompt = [
      {
        role: 'system' as const,
        content: 'Stable instructions',
      },
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Earlier question' }],
      },
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Earlier answer' }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Latest question' }],
      },
    ];

    expect(insertContextBeforeLatestMessage(prompt, 'Dynamic context')).toEqual([
      ...prompt.slice(0, -1),
      {
        role: 'system',
        content: 'Dynamic context',
      },
      prompt.at(-1),
    ]);
  });

  it('supports an empty prompt', () => {
    expect(insertContextBeforeLatestMessage([], 'Dynamic context')).toEqual([
      {
        role: 'system',
        content: 'Dynamic context',
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { insertContextBeforeLatestUserMessage } from './late-context';

describe('insertContextBeforeLatestUserMessage', () => {
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

    expect(insertContextBeforeLatestUserMessage(prompt, 'Dynamic context')).toEqual([
      ...prompt.slice(0, -1),
      {
        role: 'system',
        content: 'Dynamic context',
      },
      prompt.at(-1),
    ]);
  });

  it('keeps the current-turn prefix stable after tool calls append messages', () => {
    const prompt = [
      {
        role: 'system' as const,
        content: 'Stable instructions',
      },
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Current question' }],
      },
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'tool-call-1',
            toolName: 'read_calendar',
            input: {},
          },
        ],
      },
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: 'tool-call-1',
            toolName: 'read_calendar',
            output: { type: 'text' as const, value: 'No events.' },
          },
        ],
      },
    ];

    expect(insertContextBeforeLatestUserMessage(prompt, 'Dynamic context')).toEqual([
      prompt[0],
      {
        role: 'system',
        content: 'Dynamic context',
      },
      ...prompt.slice(1),
    ]);
  });

  it('supports an empty prompt', () => {
    expect(insertContextBeforeLatestUserMessage([], 'Dynamic context')).toEqual([
      {
        role: 'system',
        content: 'Dynamic context',
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { extractResponseText, formatAskUserQuestion, readAskUserSuspension } from './response';

describe('agent response boundary', () => {
  it('posts only the terminal step instead of concatenating retry/prose steps', () => {
    expect(
      extractResponseText({
        text: 'I will do it.I will do it.',
        steps: [
          { text: 'I will do it.', finishReason: 'stop' },
          { text: 'I will do it.', finishReason: 'stop' },
        ],
      }),
    ).toBe('I will do it.');
  });

  it('keeps ask_user as a continuation instead of treating it as a failed turn', () => {
    const suspension = readAskUserSuspension({
      finishReason: 'suspended',
      runId: 'run-1',
      suspendPayload: {
        toolName: 'ask_user',
        toolCallId: 'tool-1',
        suspendPayload: {
          question: 'When should I remind you?',
          options: [{ label: 'In one hour' }, { label: 'Tomorrow' }],
        },
      },
    });

    expect(suspension).toEqual({
      runId: 'run-1',
      toolCallId: 'tool-1',
      question: 'When should I remind you?',
      options: [{ label: 'In one hour' }, { label: 'Tomorrow' }],
    });
    expect(formatAskUserQuestion(suspension!)).toContain('1. In one hour');
  });

  it('uses an ASCII hyphen between deterministic ask_user option labels and descriptions', () => {
    expect(
      formatAskUserQuestion({
        runId: 'run-1',
        toolCallId: 'tool-1',
        question: 'Which one?',
        options: [{ label: 'Soon', description: 'In one hour' }],
      }),
    ).toContain('1. Soon - In one hour');
    expect(
      formatAskUserQuestion({
        runId: 'run-1',
        toolCallId: 'tool-1',
        question: 'Which one?',
        options: [{ label: 'Soon', description: 'In one hour' }],
      }),
    ).not.toContain('—');
  });
});

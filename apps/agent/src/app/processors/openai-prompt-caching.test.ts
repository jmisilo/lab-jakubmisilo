import { describe, expect, it } from 'vitest';

import { createUserScopedPromptCacheKey, OpenAIPromptCacheKeys } from '../agent/prompt-cache';
import { OpenAIPromptCachingProcessor } from './openai-prompt-caching';

const GPT56Model = {
  provider: 'openai.responses',
  modelId: 'gpt-5.6-luna',
};

describe('OpenAIPromptCachingProcessor', () => {
  it('marks the two most recent completed user turns and leaves volatile context unmarked', () => {
    const processor = new OpenAIPromptCachingProcessor();
    const prompt = [
      systemMessage('Stable instructions'),
      userMessage('Old question'),
      assistantMessage('Old answer'),
      userMessage('Recent question'),
      assistantMessage('Recent answer'),
      userMessage('Newest completed question'),
      assistantMessage('Newest completed answer'),
      systemMessage('Current runtime and knowledge'),
      userMessage('Latest question'),
    ];

    const result = processor.processLLMRequest({
      model: GPT56Model,
      prompt,
    } as never);

    expect(result?.prompt).toEqual([
      prompt[0],
      prompt[1],
      prompt[2],
      cachedUserMessage('Recent question'),
      prompt[4],
      cachedUserMessage('Newest completed question'),
      prompt[6],
      prompt[7],
      prompt[8],
    ]);
  });

  it('preserves provider metadata, marks the final cacheable part, and is idempotent', () => {
    const processor = new OpenAIPromptCachingProcessor();
    const prompt = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: 'Review this file.',
          },
          {
            type: 'file' as const,
            data: 'file-123',
            mediaType: 'application/pdf',
            providerOptions: {
              openai: {
                customOption: 'preserved',
              },
              testProvider: {
                value: true,
              },
            },
          },
        ],
      },
      assistantMessage('Done.'),
      userMessage('Latest question'),
    ];

    const first = processor.processLLMRequest({
      model: GPT56Model,
      prompt,
    } as never);
    const second = processor.processLLMRequest({
      model: GPT56Model,
      prompt: first?.prompt,
    } as never);

    expect(first?.prompt?.[0]).toEqual({
      ...prompt[0],
      content: [
        prompt[0]?.content[0],
        {
          ...prompt[0]?.content[1],
          providerOptions: {
            openai: {
              customOption: 'preserved',
              promptCacheBreakpoint: {
                mode: 'explicit',
              },
            },
            testProvider: {
              value: true,
            },
          },
        },
      ],
    });
    expect(second?.prompt).toEqual(first?.prompt);
  });

  it('keeps first-step requests explicit and enables implicit extension caching in tool loops', () => {
    const processor = new OpenAIPromptCachingProcessor();
    const providerOptions = {
      openai: {
        promptCacheKey: createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.mainAgent),
        promptCacheOptions: {
          mode: 'explicit' as const,
          ttl: '30m' as const,
        },
        reasoningEffort: 'high',
      },
    };

    expect(
      processor.processInputStep({
        model: GPT56Model,
        providerOptions,
        stepNumber: 0,
      } as never),
    ).toBeUndefined();
    expect(
      processor.processInputStep({
        model: GPT56Model,
        providerOptions,
        stepNumber: 1,
      } as never),
    ).toEqual({
      providerOptions: {
        openai: {
          promptCacheKey: createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.mainAgent),
          promptCacheOptions: {
            mode: 'implicit',
            ttl: '30m',
          },
          reasoningEffort: 'high',
        },
      },
    });
  });

  it('does not add GPT-5.6 cache controls to another model', () => {
    const processor = new OpenAIPromptCachingProcessor();

    expect(
      processor.processLLMRequest({
        model: {
          provider: 'openai.responses',
          modelId: 'gpt-5.4-nano',
        },
        prompt: [userMessage('Question'), assistantMessage('Answer')],
      } as never),
    ).toBeUndefined();
  });
});

function systemMessage(content: string) {
  return {
    role: 'system' as const,
    content,
  };
}

function userMessage(text: string) {
  return {
    role: 'user' as const,
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

function assistantMessage(text: string) {
  return {
    role: 'assistant' as const,
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

function cachedUserMessage(text: string) {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text,
        providerOptions: {
          openai: {
            promptCacheBreakpoint: {
              mode: 'explicit',
            },
          },
        },
      },
    ],
  };
}

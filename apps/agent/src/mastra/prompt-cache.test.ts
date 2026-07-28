import { describe, expect, it } from 'vitest';

import {
  createOpenAILegacyPromptCacheOptions,
  createOpenAIPromptCacheOptions,
  OpenAIExplicitPromptCacheBreakpoint,
  OpenAIPromptCacheKeys,
} from './prompt-cache';

describe('OpenAI prompt cache configuration', () => {
  it('uses explicit 30-minute caching for GPT-5.6', () => {
    const options = createOpenAIPromptCacheOptions(OpenAIPromptCacheKeys.mainAgent);

    expect(options).toEqual({
      promptCacheKey: 'personal-agent:main:gpt-5.6:v2',
      promptCacheOptions: {
        mode: 'explicit',
        ttl: '30m',
      },
    });
    expect(options).not.toHaveProperty('promptCacheRetention');
    expect(OpenAIExplicitPromptCacheBreakpoint).toEqual({
      openai: {
        promptCacheBreakpoint: {
          mode: 'explicit',
        },
      },
    });
  });

  it('uses model-compatible in-memory routing for GPT-5.4', () => {
    const observer = createOpenAILegacyPromptCacheOptions(OpenAIPromptCacheKeys.memoryObserver);
    const reflector = createOpenAILegacyPromptCacheOptions(OpenAIPromptCacheKeys.memoryReflector);

    expect(observer).toEqual({
      promptCacheKey: 'personal-agent:memory:observer:gpt-5.4-nano:v1',
      promptCacheRetention: 'in_memory',
    });
    expect(reflector).toEqual({
      promptCacheKey: 'personal-agent:memory:reflector:gpt-5.4-nano:v1',
      promptCacheRetention: 'in_memory',
    });
    expect(observer.promptCacheKey).not.toBe(reflector.promptCacheKey);
    expect(observer).not.toHaveProperty('promptCacheOptions');
    expect(reflector).not.toHaveProperty('promptCacheOptions');
  });
});

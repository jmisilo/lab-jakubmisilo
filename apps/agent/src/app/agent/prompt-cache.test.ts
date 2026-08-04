import { describe, expect, it } from 'vitest';

import {
  createOpenAILegacyPromptCacheOptions,
  createOpenAIPromptCacheOptions,
  createUserScopedPromptCacheKey,
  OpenAIExplicitPromptCacheBreakpoint,
  OpenAIPromptCacheKeys,
} from './prompt-cache';

describe('OpenAI prompt cache configuration', () => {
  it('uses explicit 30-minute caching for GPT-5.6', () => {
    const options = createOpenAIPromptCacheOptions(OpenAIPromptCacheKeys.mainAgent);

    expect(options).toEqual({
      promptCacheKey: createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.mainAgent),
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
      promptCacheKey: createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.memoryObserver),
      promptCacheRetention: 'in_memory',
    });
    expect(reflector).toEqual({
      promptCacheKey: createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.memoryReflector),
      promptCacheRetention: 'in_memory',
    });
    expect(observer.promptCacheKey).not.toBe(reflector.promptCacheKey);
    expect(observer).not.toHaveProperty('promptCacheOptions');
    expect(reflector).not.toHaveProperty('promptCacheOptions');
  });

  it('isolates users while keeping each user key stable', () => {
    const first = createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.mainAgent, 'user-1');
    const firstRetry = createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.mainAgent, 'user-1');
    const second = createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.mainAgent, 'user-2');

    expect(first).toBe(firstRetry);
    expect(first).not.toBe(second);
    expect(first).not.toContain('user-1');
  });

  it('keeps every user-scoped key within OpenAI limits', () => {
    const observerKey = createUserScopedPromptCacheKey(
      OpenAIPromptCacheKeys.memoryObserver,
      'user-1',
    );

    expect(observerKey).toHaveLength(64);
    expect(observerKey).toMatch(/:h[0-9a-f]{20}$/);
    expect(observerKey).toBe(
      createUserScopedPromptCacheKey(OpenAIPromptCacheKeys.memoryObserver, 'user-1'),
    );
  });

  it('keeps long keys isolated by their complete key material', () => {
    const first = createUserScopedPromptCacheKey(
      `${OpenAIPromptCacheKeys.memoryObserver}:variant-a`,
      'user-1',
    );
    const second = createUserScopedPromptCacheKey(
      `${OpenAIPromptCacheKeys.memoryObserver}:variant-b`,
      'user-1',
    );

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
  });
});

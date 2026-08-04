import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

import { createHash } from 'node:crypto';

import { openai } from '@ai-sdk/openai';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';

const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;
const COMPACT_KEY_HASH_LENGTH = 20;

export const OpenAIPromptCacheKeys = {
  mainAgent: 'personal-agent:main:gpt-5.6:v2',
  memoryObserver: 'personal-agent:memory:observer:gpt-5.4-nano:v1',
  memoryReflector: 'personal-agent:memory:reflector:gpt-5.4-nano:v1',
  daySummary: 'personal-agent:day-summary:gpt-5.4-mini:v1',
  responseQuality: 'personal-agent:response-quality:gpt-5.4-nano:v1',
  knowledgePrecision: 'personal-agent:knowledge-precision:gpt-5.4-nano:v1',
  schedulingReliability: 'personal-agent:scheduling-reliability:gpt-5.4-nano:v1',
  googleSafety: 'personal-agent:google-safety:gpt-5.4-nano:v1',
  memoryContinuity: 'personal-agent:memory-continuity:gpt-5.4-nano:v1',
  knowledgeGroundedness: 'personal-agent:knowledge-groundedness:gpt-5.4-nano:v1',
} as const;

/**
 * OpenAI exposes the cache key to the provider. Keep the resource identifier
 * out of that metadata while still giving every user an isolated cache
 * namespace. A stable digest also keeps retries and serverless instances
 * aligned without leaking a phone number or another platform identifier.
 */
export function createUserScopedPromptCacheKey(baseKey: string, identityId?: string) {
  const identity = identityId?.trim() || 'anonymous';
  const identityDigest = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  const key = `${baseKey}:resource:${identityDigest}`;

  if (key.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) {
    return key;
  }

  // OpenAI currently caps prompt_cache_key at 64 characters. Keep a readable
  // prefix for diagnostics and hash the complete key so long model/category
  // names cannot alias one another or lose the resource scope.
  const keyDigest = createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, COMPACT_KEY_HASH_LENGTH);
  const prefixLength = OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH - 2 - COMPACT_KEY_HASH_LENGTH;

  return `${key.slice(0, prefixLength)}:h${keyDigest}`;
}

export const OpenAIExplicitPromptCacheBreakpoint = {
  openai: {
    promptCacheBreakpoint: {
      mode: 'explicit',
    },
  },
} as const;

export function createOpenAIPromptCacheOptions(
  promptCacheKey: string,
  identityId?: string,
): OpenAIResponsesProviderOptions {
  return {
    promptCacheKey: createUserScopedPromptCacheKey(promptCacheKey, identityId),
    promptCacheOptions: {
      mode: 'explicit',
      ttl: '30m',
    },
  };
}

// GPT-5.4 mini and nano support discounted automatic cache reads, but OpenAI does not
// currently list either model for extended 24-hour retention.
export function createOpenAILegacyPromptCacheOptions(
  promptCacheKey: string,
  identityId?: string,
): OpenAIResponsesProviderOptions {
  return {
    promptCacheKey: createUserScopedPromptCacheKey(promptCacheKey, identityId),
    promptCacheRetention: 'in_memory',
  };
}

export function createOpenAILegacyPromptCacheModel(
  modelId: 'gpt-5.4-mini' | 'gpt-5.4-nano',
  promptCacheKey: string,
  identityId?: string,
) {
  return wrapLanguageModel({
    model: openai(modelId),
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          openai: createOpenAILegacyPromptCacheOptions(promptCacheKey, identityId),
        },
      },
    }),
  });
}

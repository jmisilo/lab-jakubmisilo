import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

import { openai } from '@ai-sdk/openai';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';

export const OpenAIPromptCacheKeys = {
  mainAgent: 'personal-agent:main:gpt-5.6:v2',
  memoryObserver: 'personal-agent:memory:observer:gpt-5.4-nano:v1',
  memoryReflector: 'personal-agent:memory:reflector:gpt-5.4-nano:v1',
  daySummary: 'personal-agent:day-summary:gpt-5.4-mini:v1',
  responseQuality: 'personal-agent:response-quality:gpt-5.4-nano:v1',
  knowledgePrecision: 'personal-agent:knowledge-precision:gpt-5.4-nano:v1',
  knowledgeRecall: 'personal-agent:knowledge-recall:gpt-5.4-nano:v1',
  knowledgeFaithfulness: 'personal-agent:knowledge-faithfulness:gpt-5.4-nano:v1',
} as const;

export const OpenAIExplicitPromptCacheBreakpoint = {
  openai: {
    promptCacheBreakpoint: {
      mode: 'explicit',
    },
  },
} as const;

export function createOpenAIPromptCacheOptions(
  promptCacheKey: string,
): OpenAIResponsesProviderOptions {
  return {
    promptCacheKey,
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
): OpenAIResponsesProviderOptions {
  return {
    promptCacheKey,
    promptCacheRetention: 'in_memory',
  };
}

export function createOpenAILegacyPromptCacheModel(
  modelId: 'gpt-5.4-mini' | 'gpt-5.4-nano',
  promptCacheKey: string,
) {
  return wrapLanguageModel({
    model: openai(modelId),
    middleware: defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          openai: createOpenAILegacyPromptCacheOptions(promptCacheKey),
        },
      },
    }),
  });
}

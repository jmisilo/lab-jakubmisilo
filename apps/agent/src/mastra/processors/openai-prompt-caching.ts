import type { ProcessInputStepArgs, ProcessLLMRequestArgs } from '@mastra/core/processors';

import { OpenAIExplicitPromptCacheBreakpoint } from '../prompt-cache';

const ROLLING_PROMPT_CACHE_BOUNDARY_COUNT = 2;

export class OpenAIPromptCachingProcessor {
  readonly id = 'openai-prompt-caching';
  readonly name = 'OpenAI prompt caching';

  processInputStep({ model, providerOptions, stepNumber }: ProcessInputStepArgs) {
    if (stepNumber === 0 || !isOpenAIGPT56Model(model)) {
      return;
    }

    // A first-step explicit policy avoids a billable latest-message cache write on simple
    // turns. Once a tool loop starts, implicit mode caches its append-only step extensions.
    return {
      providerOptions: {
        ...providerOptions,
        openai: {
          ...providerOptions?.openai,
          promptCacheOptions: {
            mode: 'implicit' as const,
            ttl: '30m' as const,
          },
        },
      },
    };
  }

  processLLMRequest({ model, prompt }: ProcessLLMRequestArgs) {
    if (!isOpenAIGPT56Model(model)) {
      return;
    }

    const boundaryIndexes = findRecentCompletedUserTurns(prompt);

    if (boundaryIndexes.size === 0) {
      return;
    }

    return {
      prompt: prompt.map((message, index) =>
        boundaryIndexes.has(index) ? markUserMessageForCaching(message) : message,
      ),
    };
  }
}

function findRecentCompletedUserTurns(prompt: ProcessLLMRequestArgs['prompt']) {
  const boundaryIndexes = new Set<number>();
  let assistantSeen = false;

  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];

    if (message?.role === 'assistant') {
      assistantSeen = true;
      continue;
    }

    if (assistantSeen && message?.role === 'user') {
      boundaryIndexes.add(index);
      assistantSeen = false;

      if (boundaryIndexes.size === ROLLING_PROMPT_CACHE_BOUNDARY_COUNT) {
        break;
      }
    }
  }

  return boundaryIndexes;
}

function markUserMessageForCaching(message: ProcessLLMRequestArgs['prompt'][number]) {
  if (message.role !== 'user') {
    return message;
  }

  let boundaryIndex = -1;

  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const part = message.content[index];

    if (part?.type === 'text' || part?.type === 'file') {
      boundaryIndex = index;
      break;
    }
  }

  if (boundaryIndex === -1) {
    return message;
  }

  return {
    ...message,
    content: message.content.map((part, index) =>
      index === boundaryIndex
        ? {
            ...part,
            providerOptions: {
              ...part.providerOptions,
              openai: {
                ...part.providerOptions?.openai,
                ...OpenAIExplicitPromptCacheBreakpoint.openai,
              },
            },
          }
        : part,
    ),
  };
}

function isOpenAIGPT56Model(model: ProcessLLMRequestArgs['model']) {
  return model.provider.includes('openai') && model.modelId.startsWith('gpt-5.6');
}

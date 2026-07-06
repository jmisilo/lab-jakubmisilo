import type { ToolSet } from 'ai';

import { openai } from '@ai-sdk/openai';
import { embed, generateText, Output } from 'ai';

import { AppError, AppErrorCode } from '@/infrastructure/errors';

export class AIService {
  static readonly model = 'gpt-5.5';
  static readonly timeout = 30_000;

  static readonly embeddingModel = 'text-embedding-3-small';
  static readonly embeddingDimensions = 1536;
  static readonly embeddingTimeout = 10_000;

  static async embed(value: string): Promise<number[]> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(
        AppError.timeout({
          code: AppErrorCode.AI_EMBEDDING_TIMEOUT,
          message: 'Embedding generation timed out.',
          context: {
            model: this.embeddingModel,
            operation: 'ai.embed',
          },
          timeoutMs: this.embeddingTimeout,
        }),
      );
    }, this.embeddingTimeout);

    try {
      const result = await embed({
        model: openai.embedding(this.embeddingModel),
        value,
        maxRetries: 1,
        abortSignal: abortController.signal,
      });

      return result.embedding;
    } finally {
      clearTimeout(timeout);
    }
  }

  static async generate<OUTPUT extends Output.Output = ReturnType<typeof Output.text>>(
    input: AIGenerateInput<OUTPUT>,
  ) {
    const resolvedModel = input.model ?? openai(this.model);
    const timeout = input.timeout ?? this.timeout;

    try {
      return await generateText({
        ...input,
        model: resolvedModel,
        maxRetries: input.maxRetries ?? 1,
        timeout,
      });
    } catch (error) {
      if (this.#isTimeoutError(error)) {
        throw AppError.timeout({
          code: AppErrorCode.AI_GENERATE_TIMEOUT,
          message: 'AI text generation timed out.',
          context: {
            model: this.#getModelLogValue(resolvedModel),
            operation: 'ai.generate',
          },
          timeoutMs: this.#getTimeoutContextMs(timeout),
          cause: error,
        });
      }

      throw error;
    }
  }

  static #getModelLogValue(model: AIGenerateTextInput<Output.Output>['model']) {
    return typeof model === 'string' ? model : model.modelId;
  }

  static #getTimeoutContextMs(timeout: AIGenerateTextInput<Output.Output>['timeout']) {
    if (typeof timeout === 'number') {
      return timeout;
    }

    return (
      timeout?.totalMs ?? timeout?.stepMs ?? timeout?.chunkMs ?? timeout?.toolMs ?? this.timeout
    );
  }

  static #isTimeoutError(error: unknown) {
    return error instanceof Error && error.name === 'TimeoutError';
  }
}

type AIGenerateTextInput<OUTPUT extends Output.Output> = Parameters<
  typeof generateText<ToolSet, Record<string, unknown>, OUTPUT>
>[0];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type AIGenerateInput<OUTPUT extends Output.Output> = DistributiveOmit<
  AIGenerateTextInput<OUTPUT>,
  'model'
> & {
  model?: AIGenerateTextInput<OUTPUT>['model'];
};

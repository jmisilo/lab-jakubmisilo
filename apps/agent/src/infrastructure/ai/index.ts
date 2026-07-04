import type { ModelMessage } from 'ai';

import { openai } from '@ai-sdk/openai';
import { embed, generateText } from 'ai';

import { AppError, AppErrorCode } from '@/infrastructure/errors';

export class AIService {
  static readonly model = 'gpt-5.4-nano';
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

  static async generate({
    instructions,
    model = AIService.model,
    messages,
    timeoutMs = AIService.timeout,
  }: {
    instructions?: Parameters<typeof generateText>[0]['instructions'];
    messages: ModelMessage[];
    model?: Parameters<typeof openai>[0];
    timeoutMs?: number;
  }) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(
        AppError.timeout({
          code: AppErrorCode.AI_GENERATE_TIMEOUT,
          message: 'AI text generation timed out.',
          context: {
            model,
            operation: 'ai.generate',
          },
          timeoutMs,
        }),
      );
    }, timeoutMs);

    try {
      const result = await generateText({
        model: openai(model),
        instructions,
        maxRetries: 1,
        abortSignal: abortController.signal,
        messages,
      });

      return result.text;
    } finally {
      clearTimeout(timeout);
    }
  }
}

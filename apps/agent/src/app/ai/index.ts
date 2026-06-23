import type { ModelMessage } from 'ai';

import { openai } from '@ai-sdk/openai';
import { embed, generateText } from 'ai';

export class AIService {
  static readonly model = 'gpt-5.4-nano';
  static readonly timeout = 30_000;

  static readonly embeddingModel = 'text-embedding-3-small';
  static readonly embeddingDimensions = 1536;
  static readonly embeddingTimeout = 10_000;

  static async embed(value: string): Promise<number[]> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`embedding_timeout`));
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
    model = AIService.model,
    messages,
    timeoutMs = AIService.timeout,
  }: {
    messages: ModelMessage[];
    model?: Parameters<typeof openai>[0];
    timeoutMs?: number;
  }) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`ai_generate_timeout_${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const result = await generateText({
        model: openai(model),
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

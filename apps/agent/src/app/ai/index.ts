import { openai } from "@ai-sdk/openai";
import type { ModelMessage } from "ai";
import { embed, generateText } from "ai";

export class AIService {
  static readonly compressionModel = "gpt-5.4-nano";
  static readonly compressionTimeoutMs = 30_000;
  static readonly embeddingModel = "text-embedding-3-small";
  static readonly embeddingDimensions = 1536;
  static readonly embeddingTimeoutMs = 10_000;

  static async embed(value: string): Promise<number[]> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(
        new Error(`embedding_timeout_${this.embeddingTimeoutMs}ms`),
      );
    }, this.embeddingTimeoutMs);

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
    model,
    messages,
    timeoutMs,
  }: {
    model: string;
    messages: ModelMessage[];
    timeoutMs: number;
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

import type { ToolSet } from 'ai';

import { openai } from '@ai-sdk/openai';
import { embed, generateText, Output } from 'ai';

export class AIService {
  static readonly model = 'gpt-5.5';

  static readonly embeddingModel = 'text-embedding-3-small';
  static readonly embeddingDimensions = 1536;

  static async embed(value: string): Promise<number[]> {
    const result = await embed({
      model: openai.embedding(this.embeddingModel),
      value,
      maxRetries: 1,
    });

    return result.embedding;
  }

  static async generate<OUTPUT extends Output.Output = ReturnType<typeof Output.text>>(
    input: AIGenerateInput<OUTPUT>,
  ) {
    const resolvedModel = input.model ?? openai(this.model);

    return generateText({
      ...input,
      model: resolvedModel,
      maxRetries: input.maxRetries ?? 1,
    });
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

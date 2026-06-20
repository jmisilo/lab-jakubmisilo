import { openai } from "@ai-sdk/openai";
import { isStepCount, ToolLoopAgent, type ModelMessage } from "ai";

import { instruction } from "@/app/instruction";
import { logger } from "@/infrastructure/logger";

export class AIAgentService {
  private static timeout = {
    total: 30_000,
    step: 20_000,
  };

  private static get model() {
    return "gpt-5.4-nano";
  }

  static readonly agent = new ToolLoopAgent({
    model: openai(this.model),
    instructions: instruction,
    maxRetries: 1,
    stopWhen: isStepCount(3),
    onStart: (event) => {
      logger.info(
        { model: this.model, lastMessage: event.messages.at(-1) },
        "[AI_AGENT]: agent process started",
      );
    },
    onStepStart: (event) => {
      logger.info(
        { provider: event.provider, modelId: event.modelId },
        "[AI_AGENT]: step started",
      );
    },
    onStepEnd: (event) => {
      logger.info(
        { finishReason: event.finishReason, text: event.text },
        "[AI_AGENT]: step ended",
      );
    },
    onEnd: (event) => {
      logger.info({ result: event.text }, "[AI_AGENT]: agent process ended");
    },
  });

  static async generate(
    input: { prompt: string } | { messages: ModelMessage[] },
  ): Promise<{ text: string }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(
        new Error(`assistant_generate_timeout_${this.timeout.total}ms`),
      );
    }, this.timeout.total);

    try {
      logger.info({ model: this.model }, "[AI_AGENT]: generating response");

      const result = await this.agent.generate({
        ...input,
        abortSignal: abortController.signal,
        timeout: { totalMs: this.timeout.total, stepMs: this.timeout.step },
      });

      logger.info("[AI_AGENT]: response generated");

      return { text: result.text };
    } catch (error) {
      logger.error({ error }, "[AI_AGENT]: response generation failed");

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

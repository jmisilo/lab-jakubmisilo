import { openai } from "@ai-sdk/openai";
import { isStepCount, ToolLoopAgent, type ModelMessage } from "ai";
import { z } from "zod/v4";

import { agentTools } from "@/app/agent/tools";
import { instruction } from "@/app/instruction";
import { logger } from "@/infrastructure/logger";

const AgentRuntimeContextSchema = z.object({
  identityId: z.string(),
});

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
    tools: agentTools,
    toolsContext: {
      "create-noted-memory": {
        identityId: "123",
      },
    },
    callOptionsSchema: AgentRuntimeContextSchema,
    prepareCall: ({ options, ...input }) => ({
      ...input,
      toolsContext: {
        "create-noted-memory": {
          identityId:
            options?.identityId ??
            input.toolsContext["create-noted-memory"].identityId,
        },
      },
    }),
    maxRetries: 1,
    stopWhen: isStepCount(5),
    onStart: (event) => {
      logger.debug(
        { model: this.model, lastMessage: event.messages.at(-1) },
        "[AI_AGENT]: agent process started",
      );
    },
    onStepStart: (event) => {
      logger.debug(
        { provider: event.provider, modelId: event.modelId },
        "[AI_AGENT]: step started",
      );
    },
    onStepEnd: (event) => {
      logger.debug(
        { finishReason: event.finishReason, text: event.text },
        "[AI_AGENT]: step ended",
      );
    },
    onEnd: (event) => {
      logger.debug({ result: event.text }, "[AI_AGENT]: agent process ended");
    },
  });

  static async generate({
    identityId,
    messages,
  }: {
    messages: ModelMessage[];
    identityId: string;
  }): Promise<{ text: string }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(
        new Error(`assistant_generate_timeout_${this.timeout.total}ms`),
      );
    }, this.timeout.total);

    try {
      logger.debug({ model: this.model }, "[AI_AGENT]: generating response");

      const result = await this.agent.generate({
        messages,
        options: { identityId },
        abortSignal: abortController.signal,
        timeout: { totalMs: this.timeout.total, stepMs: this.timeout.step },
      });

      logger.info({ model: this.model }, "[AI_AGENT]: response generated");

      return { text: result.text };
    } catch (error) {
      logger.error({ error }, "[AI_AGENT]: response generation failed");

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

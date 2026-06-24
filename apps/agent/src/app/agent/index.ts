import type { AgentTools } from '@/app/agent/tools';
import type { ModelMessage } from 'ai';

import { openai } from '@ai-sdk/openai';
import { isStepCount, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import { agentTools } from '@/app/agent/tools';
import { instruction } from '@/app/instruction';
import { logger } from '@/infrastructure/logger';

const AgentRuntimeContextSchema = z.object({
  identityId: z.string(),
  threadId: z.string().optional(),
  sourceMessageId: z.string().optional(),
});

const LOCAL_AGENT_IDENTITY_ID = 'local-agent';
const LOCAL_AGENT_THREAD_ID = 'local-tui';

export class AIAgentService {
  private static timeout = {
    total: 30_000,
    step: 20_000,
  };

  private static model = 'gpt-5.4-nano';

  static readonly agent = new ToolLoopAgent({
    model: openai(this.model),
    instructions: instruction,
    tools: agentTools,
    toolsContext: {
      'create-noted-memory': {
        identityId: LOCAL_AGENT_IDENTITY_ID,
      },
      'manage-world-cup-subscription': {
        identityId: LOCAL_AGENT_IDENTITY_ID,
        threadId: LOCAL_AGENT_THREAD_ID,
      },
    },
    callOptionsSchema: AgentRuntimeContextSchema,
    prepareCall: ({ options, ...input }) => ({
      ...input,
      toolsContext: {
        'create-noted-memory': {
          identityId: options?.identityId ?? input.toolsContext['create-noted-memory'].identityId,
        },
        'manage-world-cup-subscription': {
          identityId:
            options?.identityId ?? input.toolsContext['manage-world-cup-subscription'].identityId,
          threadId:
            options?.threadId ?? input.toolsContext['manage-world-cup-subscription'].threadId,
          sourceMessageId:
            options?.sourceMessageId ??
            input.toolsContext['manage-world-cup-subscription'].sourceMessageId,
        },
      },
    }),
    maxRetries: 1,
    stopWhen: isStepCount(5),
    onStart: (event) => {
      logger.info(
        { model: this.model, lastMessage: event.messages.at(-1) },
        '[AI_AGENT]: agent process started',
      );
    },
    onStepStart: (event) => {
      logger.debug(
        { provider: event.provider, modelId: event.modelId },
        '[AI_AGENT]: step started',
      );
    },
    onStepEnd: (event) => {
      logger.debug(
        { finishReason: event.finishReason, text: event.text },
        '[AI_AGENT]: step ended',
      );
    },
    onEnd: (event) => {
      logger.info({ result: event.text }, '[AI_AGENT]: agent process ended');
    },
  });

  static async generate({
    identityId,
    threadId,
    sourceMessageId,
    messages,
  }: {
    messages: ModelMessage[];
    identityId: string;
    threadId?: string;
    sourceMessageId?: string;
  }): Promise<{ text: string }> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`assistant_generate_timeout_${this.timeout.total}ms`));
    }, this.timeout.total);

    try {
      logger.debug({ model: this.model }, '[AI_AGENT]: generating response');

      const result = await this.agent.generate({
        messages,
        options: { identityId, threadId, sourceMessageId },
        abortSignal: abortController.signal,
        timeout: { totalMs: this.timeout.total, stepMs: this.timeout.step },
      });

      logger.info({ model: this.model }, '[AI_AGENT]: response generated');

      return { text: result.text };
    } catch (error) {
      logger.error({ error }, '[AI_AGENT]: response generation failed');

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

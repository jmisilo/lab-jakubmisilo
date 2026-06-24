import type { AgentTools } from '@/app/agent/tools';
import type { ModelMessage } from 'ai';

import { openai } from '@ai-sdk/openai';
import { isStepCount, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import { agentTools } from '@/app/agent/tools';
import { instruction } from '@/app/instruction';
import { logger } from '@/infrastructure/logger';

const AgentRuntimeContextSchema = z.object({
  identityId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  sourceMessageId: z.string().optional(),
  timeZone: z.string().min(1).optional(),
});

type AgentRuntimeContext = z.infer<typeof AgentRuntimeContextSchema>;

const UNAVAILABLE_TOOL_CONTEXT = 'tool-context-unavailable';
const DEFAULT_USER_TIME_ZONE = 'Europe/Warsaw';

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
    /**
     * AI SDK requires initial context objects for tools with context schemas. These sentinels are not used for persistence because `prepareCall` disables context-dependent tools until real call options provide the required identity/thread context.
     */
    toolsContext: {
      'create-noted-memory': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'manage-world-cup-subscription': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
        threadId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'get-world-cup-context': {
        timeZone: DEFAULT_USER_TIME_ZONE,
      },
    },
    callOptionsSchema: AgentRuntimeContextSchema,
    prepareCall: ({ options, ...input }) => ({
      ...input,
      activeTools: this.getActiveTools(options),
      toolsContext: {
        'create-noted-memory': {
          identityId: options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT,
        },
        'manage-world-cup-subscription': {
          identityId: options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT,
          threadId: options?.threadId ?? UNAVAILABLE_TOOL_CONTEXT,
          sourceMessageId: options?.sourceMessageId,
        },
        'get-world-cup-context': {
          timeZone: options?.timeZone ?? DEFAULT_USER_TIME_ZONE,
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

  private static getActiveTools(options?: AgentRuntimeContext): (keyof AgentTools & string)[] {
    const activeTools: (keyof AgentTools)[] = [
      'webSearch',
      'get-world-cup-context',
      'get-weather',
      'get-local-time',
    ];

    if (options?.identityId) {
      activeTools.push('create-noted-memory');
    }

    if (options?.identityId && options.threadId) {
      activeTools.push('manage-world-cup-subscription');
    }

    return activeTools;
  }

  static async generate({
    identityId,
    threadId,
    sourceMessageId,
    timeZone,
    messages,
  }: {
    messages: ModelMessage[];
    identityId: string;
    threadId?: string;
    sourceMessageId?: string;
    timeZone?: string;
  }) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error(`assistant_generate_timeout_${this.timeout.total}ms`));
    }, this.timeout.total);

    try {
      logger.debug({ model: this.model }, '[AI_AGENT]: generating response');

      const result = await this.agent.generate({
        messages,
        options: { identityId, threadId, sourceMessageId, timeZone },
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

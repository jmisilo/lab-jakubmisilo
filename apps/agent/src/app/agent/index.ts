import type { AgentTools } from '@/app/agent/tools';
import type { ModelMessage } from 'ai';

import { openai } from '@ai-sdk/openai';
import { isStepCount, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import { AgentPromptService } from '@/app/agent/prompt';
import { agentTools } from '@/app/agent/tools';
import { AppError, AppErrorCode } from '@/infrastructure/errors';
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

export class AgentService {
  static #timeout = {
    total: 30_000,
    step: 20_000,
  };

  static #model = 'gpt-5.5';

  static readonly agent = new ToolLoopAgent({
    model: openai('gpt-5.5'),
    instructions: AgentPromptService.buildSystemPrompt({
      identityId: UNAVAILABLE_TOOL_CONTEXT,
      currentDate: 'provided-at-call-time',
      timeZone: DEFAULT_USER_TIME_ZONE,
      tools: Object.keys(agentTools),
    }),
    tools: agentTools,
    /**
     * AI SDK requires initial context objects for tools with context schemas. These sentinels are not used for persistence because `prepareCall` disables context-dependent tools until real call options provide the required identity/thread context.
     */
    toolsContext: {
      'manage-knowledge': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'manage-world-cup-subscription': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
        threadId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'get-world-cup-tracking': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
        threadId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'get-world-cup-context': {
        timeZone: DEFAULT_USER_TIME_ZONE,
      },
    },
    callOptionsSchema: AgentRuntimeContextSchema,
    prepareCall: ({ options, ...input }) => {
      const timeZone = options?.timeZone ?? DEFAULT_USER_TIME_ZONE;
      const activeTools = this.#getActiveTools(options);

      return {
        ...input,
        instructions: AgentPromptService.buildSystemPrompt({
          identityId: options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT,
          currentDate: this.#getCurrentDate({ timeZone }),
          timeZone,
          tools: activeTools,
        }),
        activeTools,
        toolsContext: {
          'manage-knowledge': {
            identityId: options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT,
            sourceMessageId: options?.sourceMessageId,
          },
          'manage-world-cup-subscription': {
            identityId: options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT,
            threadId: options?.threadId ?? UNAVAILABLE_TOOL_CONTEXT,
            sourceMessageId: options?.sourceMessageId,
          },
          'get-world-cup-tracking': {
            identityId: options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT,
            threadId: options?.threadId ?? UNAVAILABLE_TOOL_CONTEXT,
          },
          'get-world-cup-context': {
            timeZone,
          },
        },
      };
    },
    maxRetries: 1,
    stopWhen: isStepCount(5),
    onStart: (event) => {
      logger.info(
        { model: this.#model, lastMessage: event.messages.at(-1) },
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

  static #getActiveTools(options?: AgentRuntimeContext): (keyof AgentTools & string)[] {
    const activeTools: (keyof AgentTools)[] = [
      'webSearch',
      'get-world-cup-context',
      'get-weather',
      'get-local-time',
    ];

    if (options?.identityId && options.threadId) {
      activeTools.push('manage-knowledge');
      activeTools.push('manage-world-cup-subscription');
      activeTools.push('get-world-cup-tracking');
    } else if (options?.identityId) {
      activeTools.push('manage-knowledge');
    }

    return activeTools;
  }

  static #getCurrentDate({ timeZone }: { timeZone: string }) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;

      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fall through to UTC when a stored timezone is invalid.
    }

    return new Date().toISOString().slice(0, 10);
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
      abortController.abort(
        AppError.timeout({
          code: AppErrorCode.ASSISTANT_GENERATE_TIMEOUT,
          message: 'Assistant response generation timed out.',
          context: {
            model: this.#model,
            operation: 'assistant.generate',
          },
          timeoutMs: this.#timeout.total,
        }),
      );
    }, this.#timeout.total);

    try {
      logger.debug({ model: this.#model }, '[AI_AGENT]: generating response');

      const result = await this.agent.generate({
        messages,
        options: { identityId, threadId, sourceMessageId, timeZone },
        abortSignal: abortController.signal,
        timeout: {
          totalMs: this.#timeout.total,
          stepMs: this.#timeout.step,
        },
      });

      logger.info({ model: this.#model }, '[AI_AGENT]: response generated');

      return { text: result.text };
    } catch (error) {
      logger.error({ error }, '[AI_AGENT]: response generation failed');

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

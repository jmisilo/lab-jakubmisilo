import type { AgentRuntimeClockContext } from '@/app/agent/prompt';
import type { AgentTools } from '@/app/agent/tools';
import type { OpenAILanguageModelResponsesOptions } from '@ai-sdk/openai';
import type { ModelMessage } from 'ai';

import { openai } from '@ai-sdk/openai';
import { isStepCount, ToolLoopAgent } from 'ai';
import { z } from 'zod';

import { AgentPromptService } from '@/app/agent/prompt';
import { agentTools } from '@/app/agent/tools';
import { SkillService } from '@/app/skills';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';
import { AgentObservabilityService } from '@/infrastructure/observability';

const AgentRuntimeContextSchema = z.object({
  identityId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  sourceMessageId: z.string().optional(),
  mode: z.enum(['chat', 'scheduled_task']).optional(),
  correlationId: z.uuid().optional(),
  timeZone: z.string().min(1).optional(),
  scheduledTaskSideEffects: z.array(z.enum(['calendar.create'])).optional(),
});

const UNAVAILABLE_TOOL_CONTEXT = 'tool-context-unavailable';
const DEFAULT_USER_TIME_ZONE = 'Europe/Warsaw';
const AGENT_MODEL = 'gpt-5.6-luna' satisfies Parameters<typeof openai>[0];
const PROMPT_CACHE_MINIMUM_TTL = '30m';

export class AgentService {
  static #model: Parameters<typeof openai>[0] = AGENT_MODEL;

  static readonly agent = new ToolLoopAgent({
    model: openai(this.#model),
    reasoning: 'high',
    instructions: AgentPromptService.buildCacheableSystemInstructions({
      skills: SkillService.listSkills(),
    }),
    allowSystemInMessages: true,
    tools: agentTools,
    /**
     * AI SDK requires initial context objects for tools with context schemas. These sentinels are not used for persistence because `prepareCall` disables context-dependent tools until real call options provide the required identity/thread context.
     */
    toolsContext: {
      'read-knowledge': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'manage-knowledge': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'manage-google-connection': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'read-calendar': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'read-gmail': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'read-nutrition': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
        timeZone: DEFAULT_USER_TIME_ZONE,
      },
      'manage-calendar': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'manage-schedule': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
        threadId: UNAVAILABLE_TOOL_CONTEXT,
      },
      'manage-nutrition': {
        identityId: UNAVAILABLE_TOOL_CONTEXT,
        threadId: UNAVAILABLE_TOOL_CONTEXT,
        timeZone: DEFAULT_USER_TIME_ZONE,
      },
    },
    callOptionsSchema: AgentRuntimeContextSchema,
    prepareCall: ({ options, ...input }) => {
      const timeZone = options?.timeZone ?? DEFAULT_USER_TIME_ZONE;
      const activeTools = this.#getActiveTools(options);
      const skills = SkillService.listSkills();
      const identityId = options?.identityId ?? UNAVAILABLE_TOOL_CONTEXT;

      return {
        ...input,
        instructions: AgentPromptService.buildCacheableSystemInstructions({
          skills,
        }),
        allowSystemInMessages: true,
        activeTools,
        toolOrder: activeTools,
        telemetry:
          options?.identityId && options.correlationId
            ? AgentObservabilityService.createAgentTelemetry({
                identityId: options.identityId,
                threadId: options.threadId,
                mode: options.mode ?? 'chat',
                correlationId: options.correlationId,
              })
            : { isEnabled: false },
        providerOptions: {
          openai: {
            promptCacheKey: AgentPromptService.buildPromptCacheKey({
              identityId,
              tools: activeTools,
              skills,
            }),
            promptCacheOptions: {
              mode: 'explicit',
              ttl: PROMPT_CACHE_MINIMUM_TTL,
            },
            passThroughUnsupportedFiles: true,
          } satisfies OpenAILanguageModelResponsesOptions,
        },
        toolsContext: {
          'read-knowledge': {
            identityId,
            sourceMessageId: options?.sourceMessageId,
          },
          'manage-knowledge': {
            identityId,
            sourceMessageId: options?.sourceMessageId,
          },
          'manage-google-connection': {
            identityId,
            threadId: options?.threadId,
            sourceMessageId: options?.sourceMessageId,
            mode: options?.mode,
          },
          'read-calendar': {
            identityId,
            threadId: options?.threadId,
            sourceMessageId: options?.sourceMessageId,
            mode: options?.mode,
          },
          'read-gmail': {
            identityId,
            threadId: options?.threadId,
            sourceMessageId: options?.sourceMessageId,
            mode: options?.mode,
          },
          'read-nutrition': {
            identityId,
            threadId: options?.threadId,
            sourceMessageId: options?.sourceMessageId,
            timeZone,
            mode: options?.mode,
          },
          'manage-calendar': {
            identityId,
            threadId: options?.threadId,
            sourceMessageId: options?.sourceMessageId,
            mode: options?.mode,
            allowedSideEffects: options?.scheduledTaskSideEffects,
          },
          'manage-schedule': {
            identityId,
            threadId: options?.threadId ?? UNAVAILABLE_TOOL_CONTEXT,
            sourceMessageId: options?.sourceMessageId,
          },
          'manage-nutrition': {
            identityId,
            threadId: options?.threadId,
            sourceMessageId: options?.sourceMessageId,
            timeZone,
            mode: options?.mode,
          },
        },
      };
    },
    maxRetries: 1,
    stopWhen: isStepCount(12),
  });

  static async generate({
    identityId,
    threadId,
    sourceMessageId,
    mode = 'chat',
    timeZone,
    scheduledTaskSideEffects,
    messages,
  }: {
    messages: ModelMessage[];
    identityId: string;
    threadId?: string;
    sourceMessageId?: string;
    mode?: AgentRuntimeContext['mode'];
    timeZone?: string;
    scheduledTaskSideEffects?: AgentRuntimeContext['scheduledTaskSideEffects'];
  }) {
    const correlationId = AgentObservabilityService.createCorrelationId();

    try {
      const runtimeClock = this.#getRuntimeClock({
        timeZone: timeZone ?? DEFAULT_USER_TIME_ZONE,
      });
      const result = await this.agent.generate({
        messages: AgentPromptService.buildMessagesWithRuntimeContext({ messages, runtimeClock }),
        options: {
          identityId,
          threadId,
          sourceMessageId,
          mode,
          correlationId,
          timeZone: runtimeClock.timeZone,
          scheduledTaskSideEffects,
        },
      });

      logger.info(
        {
          identityId,
          threadId,
          sourceMessageId,
          mode,
          correlationId,
          model: this.#model,
          finishReason: result.finishReason,
          stepCount: result.steps.length,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          promptCacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens,
          promptCacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens,
          promptNoCacheTokens: result.usage.inputTokenDetails.noCacheTokens,
        },
        '[AI_AGENT]: response generated',
      );

      return { text: result.text };
    } catch (error) {
      logger.error(
        {
          identityId,
          threadId,
          sourceMessageId,
          mode,
          correlationId,
          model: this.#model,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AI_AGENT]: response generation failed',
      );

      throw error;
    }
  }

  static #getActiveTools(options?: AgentRuntimeContext): (keyof AgentTools & string)[] {
    const activeTools: (keyof AgentTools)[] = [
      'load-skill',
      'webSearch',
      'get-weather',
      'get-local-time',
    ];

    if (options?.identityId) {
      activeTools.push('read-knowledge');
      activeTools.push('read-calendar');
      activeTools.push('read-gmail');
      activeTools.push('read-nutrition');
    }

    if (options?.mode === 'scheduled_task') {
      if (options.identityId && options.scheduledTaskSideEffects?.includes('calendar.create')) {
        activeTools.push('manage-calendar');
      }

      return activeTools;
    }

    if (options?.identityId && options.threadId) {
      activeTools.push('manage-google-connection');
      activeTools.push('manage-calendar');
      activeTools.push('manage-schedule');
      activeTools.push('manage-nutrition');
      activeTools.push('manage-knowledge');
    } else if (options?.identityId) {
      activeTools.push('manage-knowledge');
    }

    return activeTools;
  }

  static #getRuntimeClock({
    timeZone,
    now = new Date(),
  }: {
    timeZone: string;
    now?: Date;
  }): AgentRuntimeClockContext {
    return {
      currentDate: this.#getCurrentDate({ timeZone, now }),
      currentDateTime: this.#getCurrentDateTime({ timeZone, now }),
      currentUtcDateTime: now.toISOString(),
      currentWeekday: this.#getCurrentWeekday({ timeZone, now }),
      timeZone,
      timeZoneOffset: this.#getTimeZoneOffset({ timeZone, now }),
    };
  }

  static #getCurrentDate({ timeZone, now }: { timeZone: string; now: Date }) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;

      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fall through to UTC when a stored timezone is invalid.
    }

    return now.toISOString().slice(0, 10);
  }

  static #getCurrentDateTime({ timeZone, now }: { timeZone: string; now: Date }) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(now);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      const hour = parts.find((part) => part.type === 'hour')?.value;
      const minute = parts.find((part) => part.type === 'minute')?.value;

      if (year && month && day && hour && minute) {
        return `${year}-${month}-${day} ${hour}:${minute}`;
      }
    } catch {
      // Fall through to UTC when a stored timezone is invalid.
    }

    return now.toISOString().slice(0, 16).replace('T', ' ');
  }

  static #getCurrentWeekday({ timeZone, now }: { timeZone: string; now: Date }) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'long',
      }).format(now);
    } catch {
      return 'UTC day';
    }
  }

  static #getTimeZoneOffset({ timeZone, now }: { timeZone: string; now: Date }) {
    try {
      const offset = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
      })
        .formatToParts(now)
        .find((part) => part.type === 'timeZoneName')?.value;

      if (offset) {
        return offset.replace('GMT', 'UTC');
      }
    } catch {
      // Fall through to UTC when a stored timezone is invalid.
    }

    return 'UTC';
  }
}

type AgentRuntimeContext = z.infer<typeof AgentRuntimeContextSchema>;

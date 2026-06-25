import type { GetLocalTimeTool, GetWeatherTool } from '@/app/features/weather/tools';
import type {
  GetWorldCupContextTool,
  GetWorldCupTrackingTool,
  ManageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';
import type { Tool } from 'ai';

import { openai } from '@ai-sdk/openai';
import { tool } from 'ai';
import { z } from 'zod';

import { getLocalTimeTool, getWeatherTool } from '@/app/features/weather/tools';
import {
  getWorldCupContextTool,
  getWorldCupTrackingTool,
  manageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';
import { AgentMemoryService } from '@/app/memory';
import { logger } from '@/infrastructure/logger';

export const CreateNotedMemoryToolInputSchema = z.object({
  content: z.string().describe('The concise durable memory to save.'),
  kind: z
    .string()
    .optional()
    .describe(
      'A short category for the memory, for example preference, fact, task, project, or note.',
    ),
  importance: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Importance from 1 to 5. Use 1 by default.'),
});

export const CreateNotedMemoryToolOutputSchema = z.object({
  id: z.string().nullable(),
  saved: z.boolean(),
});

export const CreateNotedMemoryToolContextSchema = z.object({
  identityId: z.string(),
});

export type AgentTools = {
  webSearch: ReturnType<typeof openai.tools.webSearch>;
  'create-noted-memory': Tool<
    z.infer<typeof CreateNotedMemoryToolInputSchema>,
    z.infer<typeof CreateNotedMemoryToolOutputSchema>,
    z.infer<typeof CreateNotedMemoryToolContextSchema>
  >;
  'manage-world-cup-subscription': ManageWorldCupSubscriptionTool;
  'get-world-cup-tracking': GetWorldCupTrackingTool;
  'get-world-cup-context': GetWorldCupContextTool;
  'get-weather': GetWeatherTool;
  'get-local-time': GetLocalTimeTool;
};

/** @todo defer loading tools, upon having multiple choices */
export const agentTools: AgentTools = {
  webSearch: openai.tools.webSearch({
    searchContextSize: 'medium',
  }),

  'create-noted-memory': tool({
    description:
      "Persist durable information the assistant should remember for future conversations. Use for explicit remember/note requests, stable user preferences, durable personal facts, privacy preferences, and important project context. Do not use for transient conversation details. Examples: 'I really like X', 'I prefer concise implementation-focused updates', 'My birthday is on X', 'My favorite color is X', 'I am allergic to X', 'The project is called X and the deadline is Y', 'My default weather location is Warsaw', 'Do not ask me for my home/default weather location'. Do not hesitate to use this tool, as it's better to remember vague information, than to not remember important one.",
    inputSchema: CreateNotedMemoryToolInputSchema,
    outputSchema: CreateNotedMemoryToolOutputSchema,
    contextSchema: CreateNotedMemoryToolContextSchema,
    inputExamples: [
      {
        input: {
          content: 'The user prefers concise implementation-focused updates.',
          kind: 'preference',
          importance: 3,
        },
      },
    ],
    execute: async ({ content, kind = 'note', importance = 1 }, { context }) => {
      const memory = await AgentMemoryService.recordNotedInfo({
        identityId: context.identityId,
        content,
        kind,
        importance,
        metadata: {
          source: 'agent_tool',
        },
      });

      logger.info(
        {
          identityId: context.identityId,
          memoryId: memory?.id,
          kind,
          importance,
        },
        '[AGENT_MEMORY]: noted memory created',
      );

      return {
        id: memory?.id ?? null,
        saved: !!memory,
      };
    },
  }),

  'manage-world-cup-subscription': manageWorldCupSubscriptionTool,
  'get-world-cup-tracking': getWorldCupTrackingTool,
  'get-world-cup-context': getWorldCupContextTool,
  'get-weather': getWeatherTool,
  'get-local-time': getLocalTimeTool,
};

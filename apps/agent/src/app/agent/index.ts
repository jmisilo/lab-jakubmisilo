import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';

import {
  manageCalendarTool,
  manageGoogleConnectionTool,
  readCalendarTool,
  readGmailTool,
} from '../features/google/tools';
import { manageNutritionTool, readNutritionTool } from '../features/nutrition/tools';
import { readLocalTimeTool, readWeatherTool } from '../features/weather/tools';
import { KnowledgeContextProcessor } from '../processors/knowledge-context';
import { OpenAIPromptCachingProcessor } from '../processors/openai-prompt-caching';
import { RuntimeContextProcessor } from '../processors/runtime-context';
import { manageScheduleTool } from '../schedules/tools';
import { responseQualityScorer } from '../scorers/response-quality';
import { calendarManagementSkill } from '../skills/calendar-management';
import { calorieTrackingSkill } from '../skills/calorie-tracking';
import { gmailManagementSkill } from '../skills/gmail-management';
import { knowledgeManagementSkill } from '../skills/knowledge-management';
import { schedulingSkill } from '../skills/scheduling';
import { manageKnowledgeTool, readKnowledgeTool } from '../tools/knowledge-tools';
import { daySummaryWorkflow } from '../workflows/day-summary';
import { agentInstructions } from './prompt';
import {
  createOpenAILegacyPromptCacheModel,
  createOpenAIPromptCacheOptions,
  OpenAIExplicitPromptCacheBreakpoint,
  OpenAIPromptCacheKeys,
} from './prompt-cache';
import { AgentRequestContextSchema, resolveIdentityId } from './runtime-context';

/**
 * Mastra owns only agent execution. Transport, webhook deduplication, locks,
 * attachment preparation, and platform posting live in `src/app/bot`.
 */
export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  description:
    'A personal assistant, living "next" to the user, that can help with a variety of tasks, reducing switching between apps and tools. The purpose is to streamline the user\'s workflow and enhance productivity by providing a single point of interaction for various tasks.',
  instructions: {
    role: 'system',
    content: agentInstructions,
    providerOptions: OpenAIExplicitPromptCacheBreakpoint,
  },
  model: 'openai/gpt-5.6-luna',
  maxRetries: 1,
  requestContextSchema: AgentRequestContextSchema,
  defaultOptions: ({ requestContext }) => ({
    maxSteps: 12,
    autoResumeSuspendedTools: true,
    providerOptions: {
      openai: {
        ...createOpenAIPromptCacheOptions(
          OpenAIPromptCacheKeys.mainAgent,
          resolveIdentityId(requestContext),
        ),
        reasoningEffort: 'high',
      },
    },
  }),
  memory: new Memory({
    options: {
      generateTitle: true,
      lastMessages: 20,
      observationalMemory: {
        scope: 'resource',
        shareTokenBudget: true,
        activateAfterIdle: '30m',
        observation: {
          model: ({ requestContext }) =>
            createOpenAILegacyPromptCacheModel(
              'gpt-5.4-nano',
              OpenAIPromptCacheKeys.memoryObserver,
              resolveIdentityId(requestContext),
            ),
          providerOptions: {},
        },
        reflection: {
          providerOptions: {},
          model: ({ requestContext }) =>
            createOpenAILegacyPromptCacheModel(
              'gpt-5.4-nano',
              OpenAIPromptCacheKeys.memoryReflector,
              resolveIdentityId(requestContext),
            ),
        },
      },
    },
  }),
  inputProcessors: [
    new RuntimeContextProcessor(),
    new KnowledgeContextProcessor(),
    new TokenLimiterProcessor({
      limit: 300_000,
      trimMode: 'contiguous',
    }),
    new OpenAIPromptCachingProcessor(),
  ],
  skills: [
    knowledgeManagementSkill,
    schedulingSkill,
    calendarManagementSkill,
    gmailManagementSkill,
    calorieTrackingSkill,
  ],
  tools: {
    ask_user: askUserTool,
    read_knowledge: readKnowledgeTool,
    manage_knowledge: manageKnowledgeTool,
    manage_schedule: manageScheduleTool,
    manage_google_connection: manageGoogleConnectionTool,
    read_gmail: readGmailTool,
    read_calendar: readCalendarTool,
    manage_calendar: manageCalendarTool,
    read_nutrition: readNutritionTool,
    manage_nutrition: manageNutritionTool,
    read_weather: readWeatherTool,
    read_local_time: readLocalTimeTool,
    web_search: openai.tools.webSearch(),
  },
  workflows: {
    day_summary: daySummaryWorkflow,
  },
  scorers: {
    responseQuality: {
      scorer: responseQualityScorer,
      sampling: {
        type: 'ratio',
        rate: 0.1,
      },
    },
  },
});

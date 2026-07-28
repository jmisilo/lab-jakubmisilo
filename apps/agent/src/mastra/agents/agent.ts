import type { Message, Thread } from 'chat';

import { openai } from '@ai-sdk/openai';
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { Agent } from '@mastra/core/agent';
import { TokenLimiterProcessor, ToolCallFilter } from '@mastra/core/processors';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { waitUntil } from '@vercel/functions';

import { logger } from '../../infrastructure/logger';
import { configurePlainTextIMessageOutput } from '../channels/imessage';
import { AttachmentService } from '../modules/attachments';
import {
  manageCalendarTool,
  manageGoogleConnectionTool,
  readCalendarTool,
  readGmailTool,
} from '../modules/google/tools';
import { manageNutritionTool, readNutritionTool } from '../modules/nutrition/tools';
import { manageScheduleTool } from '../modules/scheduling/tools';
import { readLocalTimeTool, readWeatherTool } from '../modules/weather/tools';
import { KnowledgeContextProcessor } from '../processors/knowledge-context';
import { OpenAIPromptCachingProcessor } from '../processors/openai-prompt-caching';
import { RuntimeContextProcessor } from '../processors/runtime-context';
import { agentInstructions } from '../prompt';
import {
  createOpenAILegacyPromptCacheOptions,
  createOpenAIPromptCacheOptions,
  OpenAIExplicitPromptCacheBreakpoint,
  OpenAIPromptCacheKeys,
} from '../prompt-cache';
import { AgentRequestContextSchema } from '../runtime-context';
import { responseQualityScorer } from '../scorers/response-quality';
import { calendarManagementSkill } from '../skills/calendar-management';
import { calorieTrackingSkill } from '../skills/calorie-tracking';
import { gmailManagementSkill } from '../skills/gmail-management';
import { knowledgeManagementSkill } from '../skills/knowledge-management';
import { schedulingSkill } from '../skills/scheduling';
import { manageKnowledgeTool, readKnowledgeTool } from '../tools/knowledge-tools';
import { daySummaryWorkflow } from '../workflows/day-summary';

const _imessageAdapter = configurePlainTextIMessageOutput(
  createIMessageAdapter({
    provider: blooio(),
  }),
);

export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  description:
    'A personal assistant, living "next" to the user, that can help with a variety of tasks, reducing switching between apps and tools. The purpose is to streamline user\'s workflow and enhance productivity by providing a single point of interaction for various tasks.',
  instructions: {
    role: 'system',
    content: agentInstructions,
    providerOptions: OpenAIExplicitPromptCacheBreakpoint,
  },
  model: 'openai/gpt-5.6-luna',
  requestContextSchema: AgentRequestContextSchema,
  defaultOptions: {
    maxSteps: 12,
    autoResumeSuspendedTools: true,
    providerOptions: {
      openai: {
        ...createOpenAIPromptCacheOptions(OpenAIPromptCacheKeys.mainAgent),
        reasoningEffort: 'high',
      },
    },
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      lastMessages: 20,
      observationalMemory: {
        model: 'openai/gpt-5.4-nano',
        scope: 'resource',
        shareTokenBudget: true,
        temporalMarkers: true,
        activateAfterIdle: '30m',
        observation: {
          providerOptions: {
            openai: createOpenAILegacyPromptCacheOptions(OpenAIPromptCacheKeys.memoryObserver),
          },
        },
        reflection: {
          providerOptions: {
            openai: createOpenAILegacyPromptCacheOptions(OpenAIPromptCacheKeys.memoryReflector),
          },
        },
      },
    },
  }),
  inputProcessors: [
    new RuntimeContextProcessor(),
    new KnowledgeContextProcessor(),
    new ToolCallFilter({
      filterAfterToolSteps: 2,
      preserveModelOutput: true,
    }),
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
  channels: {
    adapters: {
      imessage: {
        adapter: _imessageAdapter,
        gateway: false,
        streaming: false,
        toolDisplay: 'hidden',
      },
    },
    waitUntil,
    resolveResourceId: ({ message }) => message.author.userId,
    handlers: {
      onDirectMessage: _handleMessage,
      onMention: _handleMessage,
      onSubscribedMessage: _handleMessage,
    },
    inlineMedia: ['image/*', 'application/pdf', 'video/mp4', 'video/quicktime'],
  },
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

async function _handleMessage(
  thread: Thread,
  message: Message,
  defaultHandler: (thread: Thread, message: Message) => Promise<void>,
) {
  logger.info('iMessage message handling started', {
    attachmentCount: message.attachments.length,
    messageId: message.id,
    threadId: thread.id,
  });

  await _markRead(thread);
  await _startTyping(thread);
  await AttachmentService.handleMessage(thread, message, defaultHandler);

  logger.info('iMessage message handling completed', {
    messageId: message.id,
    threadId: thread.id,
  });
}

async function _markRead(thread: Thread) {
  try {
    await _imessageAdapter.markRead(thread.id);
  } catch (error) {
    logger.warn('Failed to mark incoming iMessage as read', {
      error: _describeChannelError(error),
    });
  }
}

async function _startTyping(thread: Thread) {
  try {
    await thread.startTyping();
  } catch (error) {
    logger.warn('Failed to start iMessage typing indicator', {
      error: _describeChannelError(error),
    });
  }
}

function _describeChannelError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) };
}

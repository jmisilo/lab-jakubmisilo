import type { Message, Thread } from 'chat';

import { openai } from '@ai-sdk/openai';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { photon } from '@imessage-sdk/photon';
import { Agent } from '@mastra/core/agent';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { waitUntil } from '@vercel/functions';

import { logger } from '../../infrastructure/logger';
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
import { RuntimeContextProcessor } from '../processors/runtime-context';
import { agentInstructions } from '../prompt';
import { AgentRequestContextSchema } from '../runtime-context';
import { responseQualityScorer } from '../scorers/response-quality';
import { calendarManagementSkill } from '../skills/calendar-management';
import { calorieTrackingSkill } from '../skills/calorie-tracking';
import { gmailManagementSkill } from '../skills/gmail-management';
import { knowledgeManagementSkill } from '../skills/knowledge-management';
import { schedulingSkill } from '../skills/scheduling';
import { manageKnowledgeTool, readKnowledgeTool } from '../tools/knowledge-tools';
import { preDaySummaryWorkflow } from '../workflows/pre-day-summary';

const imessageAdapter = createIMessageAdapter({
  provider: photon(),
});

export const agent = new Agent({
  id: 'agent',
  name: 'Agent',
  description:
    'A personal assistant, living "next" to the user, that can help with a variety of tasks, reducing switching between apps and tools. The purpose is to streamline user\'s workflow and enhance productivity by providing a single point of interaction for various tasks.',
  instructions: agentInstructions,
  model: 'openai/gpt-5.6-luna',
  requestContextSchema: AgentRequestContextSchema,
  defaultOptions: {
    maxSteps: 12,
    autoResumeSuspendedTools: true,
    providerOptions: {
      openai: {
        promptCacheKey: 'personal-agent:v1',
        promptCacheOptions: {
          mode: 'implicit',
          ttl: '30m',
        },
        reasoningEffort: 'high',
      },
    },
  },
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: 'openai/gpt-5.4-nano',
        scope: 'resource',
        shareTokenBudget: true,
        temporalMarkers: true,
        activateAfterIdle: '10m',
      },
    },
  }),
  inputProcessors: [new RuntimeContextProcessor(), new KnowledgeContextProcessor()],
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
        adapter: imessageAdapter,
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
    pre_day_summary: preDaySummaryWorkflow,
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
    await imessageAdapter.markRead(thread.id);
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

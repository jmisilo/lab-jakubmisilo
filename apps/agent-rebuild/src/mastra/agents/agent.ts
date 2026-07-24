import { openai } from '@ai-sdk/openai';
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { Agent } from '@mastra/core/agent';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';

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
        adapter: createIMessageAdapter({
          provider: blooio(),
        }),
        gateway: false,
        streaming: false,
        toolDisplay: 'hidden',
      },
    },
    resolveResourceId: ({ message }) => message.author.userId,
    handlers: {
      onDirectMessage: AttachmentService.handleMessage.bind(AttachmentService),
      onMention: AttachmentService.handleMessage.bind(AttachmentService),
      onSubscribedMessage: AttachmentService.handleMessage.bind(AttachmentService),
    },
    inlineMedia: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'video/mp4',
      'video/quicktime',
    ],
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

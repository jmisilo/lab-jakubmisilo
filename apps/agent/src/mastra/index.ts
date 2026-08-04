import { Mastra } from '@mastra/core/mastra';
import { SimpleAuth } from '@mastra/core/server';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { PostgresStore } from '@mastra/pg';

import { agent } from '../app/agent/index';
import { postToThread } from '../app/bot/delivery';
import { imessageWebhookRoute } from '../app/bot/routes';
import { runScheduled } from '../app/bot/scheduled';
import { googleRoutes } from '../app/features/google/routes';
import {
  manageCalendarTool,
  manageGoogleConnectionTool,
  readCalendarTool,
  readGmailTool,
} from '../app/features/google/tools';
import { manageNutritionTool, readNutritionTool } from '../app/features/nutrition/tools';
import { readLocalTimeTool, readWeatherTool } from '../app/features/weather/tools';
import { IdentityService } from '../app/identity';
import { configureScheduleDelivery } from '../app/schedules';
import { scheduleExecutionRoute, scheduleFailureRoute } from '../app/schedules/routes';
import { manageScheduleTool } from '../app/schedules/tools';
import { googleSafetyScorer } from '../app/scorers/google';
import { knowledgeManagementScorer } from '../app/scorers/knowledge-management';
import { memoryContinuityScorer } from '../app/scorers/memory';
import { responseQualityScorer } from '../app/scorers/response-quality';
import { schedulingReliabilityScorer } from '../app/scorers/scheduling';
import { manageKnowledgeTool, readKnowledgeTool } from '../app/tools/knowledge-tools';
import { daySummaryWorkflow } from '../app/workflows/day-summary';
import { databasePool } from '../infrastructure/database';
import { logger } from '../infrastructure/logger';
import { agentObservability } from './observability';

configureScheduleDelivery({ runScheduled, postToThread });

export const mastra = new Mastra({
  deployer: new VercelDeployer({
    studio: true,
    maxDuration: 300,
    memory: 1_536,
  }),
  logger,
  agents: { agent },
  workflows: {
    daySummary: daySummaryWorkflow,
  },
  tools: {
    readKnowledgeTool,
    manageKnowledgeTool,
    manageScheduleTool,
    manageGoogleConnectionTool,
    readGmailTool,
    readCalendarTool,
    manageCalendarTool,
    readNutritionTool,
    manageNutritionTool,
    readWeatherTool,
    readLocalTimeTool,
  },
  scorers: {
    responseQuality: responseQualityScorer,
    schedulingReliability: schedulingReliabilityScorer,
    googleSafety: googleSafetyScorer,
    memoryContinuity: memoryContinuityScorer,
    knowledgeManagement: knowledgeManagementScorer,
  },
  storage: new PostgresStore({
    id: 'agent-storage',
    pool: databasePool,
    schemaName: 'mastra',
    disableInit: process.env.NODE_ENV === 'production',
  }),
  scheduler: {
    enabled: false,
  },
  server: {
    apiPrefix: '/api/mastra',
    apiRoutes: [
      imessageWebhookRoute,
      scheduleExecutionRoute,
      scheduleFailureRoute,
      ...googleRoutes,
    ],
    auth: new SimpleAuth({
      tokens: {
        [IdentityService.apiToken]: {
          id: IdentityService.studioResourceId,
          name: 'Agent owner',
        },
      },
      mapUserToResourceId: () => IdentityService.studioResourceId,
      public: ['/api/agents/agent/channels/imessage/webhook'],
    }),
  },
  observability: agentObservability,
});

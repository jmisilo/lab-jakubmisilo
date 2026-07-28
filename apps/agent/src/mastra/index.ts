import { Mastra } from '@mastra/core/mastra';
import { SimpleAuth } from '@mastra/core/server';
import { VercelDeployer } from '@mastra/deployer-vercel';
import { Observability, SensitiveDataFilter } from '@mastra/observability';
import { PostgresStore } from '@mastra/pg';

import { databasePool } from '../infrastructure/database';
import { logger } from '../infrastructure/logger';
import { agent } from './agents/agent';
import { googleRoutes } from './modules/google/routes';
import {
  manageCalendarTool,
  manageGoogleConnectionTool,
  readCalendarTool,
  readGmailTool,
} from './modules/google/tools';
import { IdentityService } from './modules/identity';
import { manageNutritionTool, readNutritionTool } from './modules/nutrition/tools';
import { SchedulingService } from './modules/scheduling';
import { scheduleExecutionRoute } from './modules/scheduling/routes';
import { manageScheduleTool } from './modules/scheduling/tools';
import { readLocalTimeTool, readWeatherTool } from './modules/weather/tools';
import { createAgentObservabilityExporters } from './observability';
import { responseQualityScorer } from './scorers/response-quality';
import { manageKnowledgeTool, readKnowledgeTool } from './tools/knowledge-tools';
import { daySummaryWorkflow } from './workflows/day-summary';

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
  schedules: {
    prepare: async ({ agentId, schedule, trigger }) => {
      if (agentId !== 'agent' || typeof schedule.cron !== 'string') {
        return undefined;
      }

      return SchedulingService.prepareOccurrence({
        scheduleId: schedule.id,
        cron: schedule.cron,
        firedAt: trigger.firedAt,
        timeZone: typeof schedule.timezone === 'string' ? schedule.timezone : 'UTC',
      });
    },
  },
  server: {
    apiPrefix: '/api/mastra',
    apiRoutes: [scheduleExecutionRoute, ...googleRoutes],
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
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'agent',
        exporters: createAgentObservabilityExporters(),
        spanOutputProcessors: [new SensitiveDataFilter()],
        logging: {
          enabled: true,
          level: 'info',
        },
      },
    },
  }),
});

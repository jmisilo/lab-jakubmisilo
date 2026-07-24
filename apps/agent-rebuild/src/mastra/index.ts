import { Mastra } from '@mastra/core/mastra';
import { SimpleAuth } from '@mastra/core/server';
import {
  MastraPlatformExporter,
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { PostgresStore } from '@mastra/pg';

import { databasePool } from '../infrastructure/database';
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
import {
  knowledgeContextPrecisionScorer,
  knowledgeContextRecallScorer,
} from './scorers/knowledge-retrieval';
import { responseQualityScorer } from './scorers/response-quality';
import { manageKnowledgeTool, readKnowledgeTool } from './tools/knowledge-tools';

export const mastra = new Mastra({
  agents: { agent },
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
    knowledgeContextPrecision: knowledgeContextPrecisionScorer,
    knowledgeContextRecall: knowledgeContextRecallScorer,
  },
  storage: new PostgresStore({
    id: 'agent-rebuild-storage',
    pool: databasePool,
    schemaName: 'mastra',
  }),
  schedules: {
    prepare: async ({ agentId, schedule, trigger }) => {
      if (agentId !== 'agent') {
        return undefined;
      }

      return SchedulingService.prepareOccurrence({
        scheduleId: schedule.id,
        firedAt: trigger.firedAt,
        timeZone: typeof schedule.timezone === 'string' ? schedule.timezone : 'UTC',
      });
    },
  },
  server: {
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
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

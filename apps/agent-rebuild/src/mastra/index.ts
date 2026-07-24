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
import { IdentityService } from './modules/identity';
import { scheduleExecutionRoute } from './modules/scheduling/routes';
import { manageScheduleTool } from './modules/scheduling/tools';
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
  server: {
    apiRoutes: [scheduleExecutionRoute],
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

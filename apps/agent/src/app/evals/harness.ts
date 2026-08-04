import type { Agent } from '@mastra/core/agent';
import type { MastraScorer } from '@mastra/core/evals';

import { randomUUID } from 'node:crypto';

import { Mastra } from '@mastra/core/mastra';
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { PostgresStore } from '@mastra/pg';

export const hasEvaluationEnvironment =
  process.env.RUN_AGENT_EVALS === 'true' &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  Boolean(process.env.DATABASE_URL?.trim());

type DatabaseModule = typeof import('../../infrastructure/database');

export async function createEvaluationHarness(scorers: Record<string, MastraScorer>) {
  const [{ agent }, databaseModule] = await Promise.all([
    import('../agent/index'),
    import('../../infrastructure/database'),
  ]);

  const evaluationMastra = new Mastra({
    agents: { agent },
    scorers,
    storage: new PostgresStore({
      id: `agent-eval-storage-${randomUUID()}`,
      pool: databaseModule.databasePool,
      schemaName: 'mastra',
    }),
  });

  return {
    agent: evaluationMastra.getAgent('agent') as unknown as Agent,
    database: databaseModule,
    identityId: `eval:${randomUUID()}`,
  };
}

export function createEvaluationRequestContext(identityId: string, threadId = randomUUID()) {
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, identityId);
  requestContext.set(MASTRA_THREAD_ID_KEY, `eval:${threadId}`);
  requestContext.set('timeZone', 'Europe/Warsaw');
  requestContext.set('channel', {
    platform: 'eval',
    eventType: 'direct',
    userId: identityId,
    threadId: `eval-thread:${threadId}`,
    messageId: `eval-message:${threadId}`,
  });

  return requestContext;
}

export function databaseForEvaluation(database: DatabaseModule) {
  return database.database;
}

import type { Agent } from '@mastra/core/agent';

import { randomUUID } from 'node:crypto';

import { runEvals } from '@mastra/core/evals';
import { Mastra } from '@mastra/core/mastra';
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { checks } from '@mastra/evals/checks';
import { PostgresStore } from '@mastra/pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { database, databasePool } from '../../infrastructure/database';
import { knowledgeNodeClosure, knowledgeNodes } from '../../infrastructure/database/schema';
import { KnowledgeService } from '../../modules/knowledge';
import { agent } from '../agents/agent';
import {
  createKnowledgeFaithfulnessScorer,
  knowledgeContextPrecisionScorer,
  knowledgeContextRecallScorer,
} from '../scorers/knowledge-retrieval';
import { responseQualityScorer } from '../scorers/response-quality';
import { knowledgeFixtureNotes, knowledgeRuntimeCases } from './datasets/knowledge';

const identityId = `eval:${randomUUID()}`;
const knowledgeFaithfulnessScorer = createKnowledgeFaithfulnessScorer(
  knowledgeFixtureNotes.map((note) => note.content),
);
const evaluationMastra = new Mastra({
  agents: { agent },
  scorers: {
    knowledgeContextPrecision: knowledgeContextPrecisionScorer,
    knowledgeContextRecall: knowledgeContextRecallScorer,
    knowledgeFaithfulness: knowledgeFaithfulnessScorer,
    responseQuality: responseQualityScorer,
  },
  storage: new PostgresStore({
    id: 'agent-rebuild-eval-storage',
    pool: databasePool,
    schemaName: 'mastra',
  }),
});
// runEvals currently constrains request-context-aware agents to Agent's default unknown context.
const evaluationAgent = evaluationMastra.getAgent('agent') as unknown as Agent;

/**
 * @url https://mastra.ai/docs/evals/running-in-ci
 */
describe.sequential('agent knowledge evaluations', () => {
  beforeAll(async () => {
    for (const note of knowledgeFixtureNotes) {
      await KnowledgeService.createNode({
        identityId,
        ...note,
        source: 'explicit',
      });
    }
  });

  afterAll(async () => {
    await database.transaction(async (transaction) => {
      await transaction
        .delete(knowledgeNodeClosure)
        .where(eq(knowledgeNodeClosure.identityId, identityId));
      await transaction.delete(knowledgeNodes).where(eq(knowledgeNodes.identityId, identityId));
    });

    await databasePool.end();
  });

  it('retrieves useful knowledge and answers from it', async () => {
    const result = await runEvals({
      target: evaluationAgent,
      data: knowledgeRuntimeCases.map((item) => ({
        ...item,
        requestContext: createRequestContext(),
      })),
      scorers: [
        { scorer: knowledgeContextPrecisionScorer, threshold: 0.8 },
        { scorer: knowledgeContextRecallScorer, threshold: 0.8 },
        { scorer: knowledgeFaithfulnessScorer, threshold: 0.8 },
        { scorer: responseQualityScorer, threshold: 0.65 },
      ],
      targetOptions: {
        maxSteps: 4,
      },
    });

    console.info('knowledge retrieval scores', result.thresholdResults);
    expect(result.verdict, JSON.stringify(result.thresholdResults, null, 2)).toBe('passed');
  });

  it('uses the durable knowledge tool for an explicit memory request', async () => {
    const result = await runEvals({
      target: evaluationAgent,
      data: [
        {
          input: 'Remember that I prefer strength training on weekdays.',
          requestContext: createRequestContext(),
        },
      ],
      gates: [checks.calledTool('manage_knowledge'), checks.noToolErrors()],
      targetOptions: {
        maxSteps: 4,
      },
    });

    console.info('knowledge write gates', result.gateResults);
    expect(result.verdict, JSON.stringify(result.gateResults, null, 2)).toBe('passed');
  });
});

function createRequestContext() {
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, identityId);
  requestContext.set(MASTRA_THREAD_ID_KEY, `eval:${randomUUID()}`);
  requestContext.set('timeZone', 'Europe/Warsaw');

  return requestContext;
}

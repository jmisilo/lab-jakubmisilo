import { randomUUID } from 'node:crypto';

import { runEvals } from '@mastra/core/evals';
import { checks } from '@mastra/evals/checks';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  googleConnections,
  knowledgeNodeClosure,
  knowledgeNodes,
  oneTimeSchedules,
} from '../../infrastructure/database/schema';
import { googleSafetyScorer } from '../scorers/google';
import { knowledgeManagementScorer } from '../scorers/knowledge-management';
import { knowledgeContextPrecisionScorer } from '../scorers/knowledge-retrieval';
import { memoryContinuityScorer } from '../scorers/memory';
import { responseQualityScorer } from '../scorers/response-quality';
import { schedulingReliabilityScorer } from '../scorers/scheduling';
import { knowledgeFixtureNotes } from './datasets/knowledge';
import {
  createEvaluationHarness,
  createEvaluationRequestContext,
  databaseForEvaluation,
  hasEvaluationEnvironment,
} from './harness';

const qstashState = vi.hoisted(() => ({ messageNumber: 0 }));

// Core evaluations exercise the model/tool boundary without creating real QStash deliveries.
// The database remains real so persistence, ownership, and idempotency paths are evaluated.
vi.mock('@upstash/qstash', () => ({
  Client: class {
    async publishJSON() {
      qstashState.messageNumber += 1;
      return { messageId: `eval-qstash-message-${qstashState.messageNumber}` };
    }

    messages = {
      cancel: async () => undefined,
      get: async () => ({ createdAt: new Date().toISOString() }),
    };

    schedules = {
      create: async () => undefined,
      get: async () => ({
        scheduleId: 'eval-trigger',
        isPaused: false,
        lastScheduleStates: [],
      }),
      pause: async () => undefined,
      resume: async () => undefined,
      delete: async () => undefined,
    };
  },
  Receiver: class {
    async verify() {
      return true;
    }
  },
}));

describe.skipIf(!hasEvaluationEnvironment).sequential('agent core evaluations', () => {
  let harness: Awaited<ReturnType<typeof createEvaluationHarness>>;

  beforeAll(async () => {
    // Scheduling remains fully offline in evaluations, but the production
    // service validates these settings before constructing its QStash client.
    // Keep deterministic placeholders so the mocked provider exercises the
    // complete persistence and idempotency path without external delivery.
    vi.stubEnv('AGENT_PUBLIC_URL', 'https://eval.agent.example.com');
    vi.stubEnv('QSTASH_TOKEN', 'eval-qstash-token');

    const { KnowledgeService } = await import('../knowledge');

    harness = await createEvaluationHarness({
      responseQuality: responseQualityScorer,
      schedulingReliability: schedulingReliabilityScorer,
      googleSafety: googleSafetyScorer,
      memoryContinuity: memoryContinuityScorer,
      knowledgeManagement: knowledgeManagementScorer,
      knowledgeContextPrecision: knowledgeContextPrecisionScorer,
    });

    for (const note of knowledgeFixtureNotes) {
      await KnowledgeService.createNode({
        identityId: harness.identityId,
        ...note,
        source: 'explicit',
      });
    }
  });

  afterAll(async () => {
    if (!harness) {
      return;
    }

    const database = databaseForEvaluation(harness.database);
    await database.transaction(async (transaction) => {
      await transaction
        .delete(knowledgeNodeClosure)
        .where(eq(knowledgeNodeClosure.identityId, harness.identityId));
      await transaction
        .delete(knowledgeNodes)
        .where(eq(knowledgeNodes.identityId, harness.identityId));
      await transaction
        .delete(oneTimeSchedules)
        .where(eq(oneTimeSchedules.resourceId, harness.identityId));
      await transaction
        .delete(googleConnections)
        .where(eq(googleConnections.resourceId, harness.identityId));
    });

    vi.unstubAllEnvs();
  });

  it('creates one reminder and confirms only the successful tool result', async () => {
    // Deliberately avoid the obvious "remind me" wording. The evaluation must
    // prove that the model selects scheduling from meaning, not a transport
    // or application-side phrase classifier.
    const input = 'I need to remember to write to Blooio in ten minutes.';
    const result = await runEvals({
      target: harness.agent,
      data: [
        {
          input,
          requestContext: createEvaluationRequestContext(harness.identityId, randomUUID()),
        },
      ],
      gates: [checks.calledTool('manage_schedule'), checks.noToolErrors()],
      scorers: [{ scorer: schedulingReliabilityScorer, threshold: 0.7 }],
      targetOptions: { maxSteps: 8 },
    });

    console.info('scheduling evaluation', result.thresholdResults, result.gateResults);
    expect(result.verdict, JSON.stringify(result, null, 2)).toBe('passed');
  });

  it('keeps Google access bounded by authorization and read/write policy', async () => {
    const status = await runEvals({
      target: harness.agent,
      data: [
        {
          input: 'Check whether my Google account is connected.',
          requestContext: createEvaluationRequestContext(harness.identityId),
        },
      ],
      gates: [checks.calledTool('manage_google_connection'), checks.noToolErrors()],
      scorers: [{ scorer: googleSafetyScorer, threshold: 0.7 }],
      targetOptions: { maxSteps: 8 },
    });

    const gmail = await runEvals({
      target: harness.agent,
      data: [
        {
          input: 'Search my Gmail for messages about QStash.',
          requestContext: createEvaluationRequestContext(harness.identityId),
        },
      ],
      gates: [checks.calledTool('read_gmail'), checks.noToolErrors()],
      scorers: [{ scorer: googleSafetyScorer, threshold: 0.7 }],
      targetOptions: { maxSteps: 8 },
    });

    console.info('Google status evaluation', status.thresholdResults, status.gateResults);
    console.info('Google Gmail evaluation', gmail.thresholdResults, gmail.gateResults);
    expect(status.verdict, JSON.stringify(status, null, 2)).toBe('passed');
    expect(gmail.verdict, JSON.stringify(gmail, null, 2)).toBe('passed');
  });

  it('keeps a relevant preference across turns without cross-resource leakage', async () => {
    const result = await runEvals({
      target: harness.agent,
      data: [
        {
          inputs: ['My preferred focus time is late afternoon.', 'What focus time do I prefer?'],
          requestContext: createEvaluationRequestContext(harness.identityId),
        },
      ],
      scorers: [{ scorer: memoryContinuityScorer, threshold: 0.7 }],
      targetOptions: {
        maxSteps: 8,
        memory: { resource: harness.identityId },
      },
    });

    console.info('memory evaluation', result.thresholdResults);
    expect(result.verdict, JSON.stringify(result, null, 2)).toBe('passed');
  });

  it('does not reuse a preference for a different resource', async () => {
    const otherIdentityId = `eval:${randomUUID()}`;
    const result = await runEvals({
      target: harness.agent,
      data: [
        {
          input: 'What focus time do I prefer?',
          groundTruth:
            "The assistant should say it does not have that preference for this user, rather than using another resource's memory.",
          requestContext: createEvaluationRequestContext(otherIdentityId),
        },
      ],
      scorers: [{ scorer: memoryContinuityScorer, threshold: 0.7 }],
      targetOptions: {
        maxSteps: 8,
        memory: { resource: otherIdentityId },
      },
    });

    console.info('memory isolation evaluation', result.thresholdResults);
    expect(result.verdict, JSON.stringify(result, null, 2)).toBe('passed');
  });

  it('retrieves durable knowledge and uses the durable tool for explicit writes', async () => {
    const retrieval = await runEvals({
      target: harness.agent,
      data: [
        {
          input: 'Where do I usually train, and what time should I avoid?',
          groundTruth:
            'The user trains at Vektor Fitness in Warsaw after work and avoids early mornings.',
          requestContext: createEvaluationRequestContext(harness.identityId),
        },
      ],
      gates: [checks.noToolErrors()],
      scorers: [
        { scorer: knowledgeContextPrecisionScorer, threshold: 0.7 },
        { scorer: knowledgeManagementScorer, threshold: 0.7 },
      ],
      targetOptions: { maxSteps: 8 },
    });

    const write = await runEvals({
      target: harness.agent,
      data: [
        {
          input: 'Remember that I prefer strength training on weekdays.',
          requestContext: createEvaluationRequestContext(harness.identityId),
        },
      ],
      gates: [checks.calledTool('manage_knowledge'), checks.noToolErrors()],
      scorers: [{ scorer: knowledgeManagementScorer, threshold: 0.7 }],
      targetOptions: { maxSteps: 8 },
    });

    console.info('knowledge retrieval evaluation', retrieval.thresholdResults);
    console.info('knowledge write evaluation', write.thresholdResults, write.gateResults);
    expect(retrieval.verdict, JSON.stringify(retrieval, null, 2)).toBe('passed');
    expect(write.verdict, JSON.stringify(write, null, 2)).toBe('passed');
  });
});

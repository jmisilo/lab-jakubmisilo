import { createScorer } from '@mastra/core/evals';
import dedent from 'dedent';
import { z } from 'zod';

import { createOpenAILegacyPromptCacheModel, OpenAIPromptCacheKeys } from '../agent/prompt-cache';
import { serializeEvaluation } from './domain-utils';

const MemoryAnalysisSchema = z.object({
  continuity: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  isolation: z.number().min(0).max(1),
  uncertainty: z.number().min(0).max(1),
  reason: z.string(),
});

export const memoryContinuityScorer = createScorer({
  id: 'memory-continuity',
  description:
    'Checks useful continuity from recent and observational memory without leaking another resource or inventing remembered facts.',
  type: 'agent',
  judge: {
    model: createOpenAILegacyPromptCacheModel(
      'gpt-5.4-nano',
      OpenAIPromptCacheKeys.memoryContinuity,
    ),
    instructions:
      'Evaluate only evidence present in the supplied trajectory and memory context. A confident unsupported claim is worse than an explicit uncertainty.',
  },
})
  .analyze({
    description: 'Assess memory continuity, relevance, and resource isolation.',
    outputSchema: MemoryAnalysisSchema,
    createPrompt: ({ run }) => dedent`
      Score each dimension from 0 to 1.

      - continuity: relevant prior facts, preferences, or unfinished tasks are used when the current request needs them.
      - relevance: remembered material is selective and does not distract from the current request.
      - isolation: no fact appears to come from another user/resource/thread.
      - uncertainty: the assistant avoids presenting weak or absent memory as certain.

      ${serializeEvaluation({ input: run.input, output: run.output, groundTruth: run.groundTruth })}
    `,
  })
  .generateScore(({ results }) => {
    const result = results.analyzeStepResult;

    return (result.continuity + result.relevance + result.isolation + result.uncertainty) / 4;
  })
  .generateReason(({ results }) => results.analyzeStepResult.reason);

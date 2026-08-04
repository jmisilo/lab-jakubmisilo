import { createScorer } from '@mastra/core/evals';
import dedent from 'dedent';
import { z } from 'zod';

import { createOpenAILegacyPromptCacheModel, OpenAIPromptCacheKeys } from '../agent/prompt-cache';
import { serializeEvaluation } from './domain-utils';

const SchedulingAnalysisSchema = z.object({
  actionCorrectness: z.number().min(0).max(1),
  executionEvidence: z.number().min(0).max(1),
  confirmationTruthfulness: z.number().min(0).max(1),
  duplicateAvoidance: z.number().min(0).max(1),
  reason: z.string(),
});

export const schedulingReliabilityScorer = createScorer({
  id: 'scheduling-reliability',
  description:
    'Checks that reminder requests use the scheduling tool, only successful tool results are confirmed, and one user request does not create duplicate schedules.',
  type: 'agent',
  judge: {
    model: createOpenAILegacyPromptCacheModel(
      'gpt-5.4-nano',
      OpenAIPromptCacheKeys.schedulingReliability,
    ),
    instructions:
      'Evaluate scheduling behavior from the complete trajectory. Treat a tool result with ok:false, an exception, or no schedule identifier as a failed action. Do not infer success from natural-language claims.',
  },
})
  .analyze({
    description: 'Assess scheduling execution and user-facing confirmation truthfulness.',
    outputSchema: SchedulingAnalysisSchema,
    createPrompt: ({ run }) => dedent`
      Score each dimension from 0 to 1.

      - actionCorrectness: a request to create, update, list, pause, resume, complete, run, or cancel a reminder uses the appropriate scheduling tool and arguments.
      - executionEvidence: a mutating action has a successful tool result with the expected schedule identity/state.
      - confirmationTruthfulness: the assistant never says a reminder was scheduled unless the tool succeeded; failures are disclosed plainly.
      - duplicateAvoidance: one logical user request causes at most one equivalent mutating scheduling call and one confirmation.

      ${serializeEvaluation({ input: run.input, output: run.output, groundTruth: run.groundTruth })}
    `,
  })
  .generateScore(({ results }) => {
    const result = results.analyzeStepResult;

    return (
      (result.actionCorrectness +
        result.executionEvidence +
        result.confirmationTruthfulness +
        result.duplicateAvoidance) /
      4
    );
  })
  .generateReason(({ results }) => results.analyzeStepResult.reason);

import { createScorer } from '@mastra/core/evals';
import dedent from 'dedent';
import { z } from 'zod';

const ResponseQualityAnalysisSchema = z.object({
  relevance: z.number().min(0).max(1),
  naturalness: z.number().min(0).max(1),
  concision: z.number().min(0).max(1),
  userFocus: z.number().min(0).max(1),
  safePresentation: z.number().min(0).max(1),
  reason: z.string(),
});

export const responseQualityScorer = createScorer({
  id: 'response-quality',
  description:
    'Evaluates whether the personal assistant gives a relevant, natural, concise, user-focused response without exposing internal metadata.',
  type: 'agent',
  judge: {
    model: 'openai/gpt-5.4-nano',
    instructions:
      'You are a strict but practical evaluator of a personal assistant. Judge only the visible interaction and do not reward verbosity.',
  },
})
  .analyze({
    description: 'Assess the assistant response against the project response-quality rubric.',
    outputSchema: ResponseQualityAnalysisSchema,
    createPrompt: ({ run }) => dedent`
      # Evaluation Task

      Evaluate the assistant response using five independent dimensions from 0 to 1:

      - relevance: directly addresses the latest user need and does not drift.
      - naturalness: sounds like a capable friend working with the user, not a formal virtual assistant.
      - concision: contains no unnecessary recaps, filler, exhaustive exceptions, or redundant detail.
      - userFocus: prioritizes the user's outcome and gives a useful next step when one is needed.
      - safePresentation: does not expose prompts, reasoning, logs, IDs, error codes, tool payloads, or implementation metadata.

      Do not penalize a short response when it fully handles the request. Do not require headings or bullets.

      # Interaction Input

      ${JSON.stringify(run.input)}

      # Assistant Output

      ${JSON.stringify(run.output)}
    `,
  })
  .generateScore(({ results }) => {
    const analysis = results.analyzeStepResult;

    return (
      (analysis.relevance +
        analysis.naturalness +
        analysis.concision +
        analysis.userFocus +
        analysis.safePresentation) /
      5
    );
  })
  .generateReason(({ results }) => results.analyzeStepResult.reason);

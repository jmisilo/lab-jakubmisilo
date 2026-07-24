import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';

import {
  createContextPrecisionScorer,
  createContextRecallScorer,
  createFaithfulnessScorer,
} from '@mastra/evals/scorers/prebuilt';

import { KnowledgeContextNoteTag } from '../../modules/knowledge/context';

const JudgeModel = 'openai/gpt-5.4-nano';

export const knowledgeContextPrecisionScorer = createContextPrecisionScorer({
  model: JudgeModel,
  options: {
    contextExtractor: getRetrievedKnowledgeContext,
  },
});

export const knowledgeContextRecallScorer = createContextRecallScorer({
  model: JudgeModel,
  options: {
    contextExtractor: getRetrievedKnowledgeContext,
  },
});

export function createKnowledgeFaithfulnessScorer(context: string[]) {
  return createFaithfulnessScorer({
    model: JudgeModel,
    options: { context },
  });
}

export function getRetrievedKnowledgeContext(
  input: ScorerRunInputForAgent,
  _output: ScorerRunOutputForAgent,
) {
  return (input.taggedSystemMessages[KnowledgeContextNoteTag] ?? []).flatMap((message) =>
    typeof message.content === 'string' ? [message.content] : [],
  );
}

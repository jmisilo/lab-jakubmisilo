import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';

import {
  createContextPrecisionScorer,
  createContextRecallScorer,
  createFaithfulnessScorer,
} from '@mastra/evals/scorers/prebuilt';

import { KnowledgeContextNoteTag } from '../modules/knowledge/context';
import { createOpenAILegacyPromptCacheModel, OpenAIPromptCacheKeys } from '../prompt-cache';

const PrecisionJudgeModel = createOpenAILegacyPromptCacheModel(
  'gpt-5.4-nano',
  OpenAIPromptCacheKeys.knowledgePrecision,
);
const RecallJudgeModel = createOpenAILegacyPromptCacheModel(
  'gpt-5.4-nano',
  OpenAIPromptCacheKeys.knowledgeRecall,
);
const FaithfulnessJudgeModel = createOpenAILegacyPromptCacheModel(
  'gpt-5.4-nano',
  OpenAIPromptCacheKeys.knowledgeFaithfulness,
);

export const knowledgeContextPrecisionScorer = createContextPrecisionScorer({
  model: PrecisionJudgeModel,
  options: {
    contextExtractor: getRetrievedKnowledgeContext,
  },
});

export const knowledgeContextRecallScorer = createContextRecallScorer({
  model: RecallJudgeModel,
  options: {
    contextExtractor: getRetrievedKnowledgeContext,
  },
});

export function createKnowledgeFaithfulnessScorer(context: string[]) {
  return createFaithfulnessScorer({
    model: FaithfulnessJudgeModel,
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

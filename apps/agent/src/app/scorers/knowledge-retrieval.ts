import type { ScorerRunInputForAgent, ScorerRunOutputForAgent } from '@mastra/core/evals';

import { createContextPrecisionScorer } from '@mastra/evals/scorers/prebuilt';

import { createOpenAILegacyPromptCacheModel, OpenAIPromptCacheKeys } from '../agent/prompt-cache';
import { KnowledgeContextNoteTag } from '../knowledge/context';

const PrecisionJudgeModel = createOpenAILegacyPromptCacheModel(
  'gpt-5.4-nano',
  OpenAIPromptCacheKeys.knowledgePrecision,
);

export const knowledgeContextPrecisionScorer = createContextPrecisionScorer({
  model: PrecisionJudgeModel,
  options: {
    contextExtractor: getRetrievedKnowledgeContext,
  },
});

export function getRetrievedKnowledgeContext(
  input: ScorerRunInputForAgent,
  _output: ScorerRunOutputForAgent,
) {
  return (input.taggedSystemMessages[KnowledgeContextNoteTag] ?? []).flatMap((message) =>
    typeof message.content === 'string' ? [message.content] : [],
  );
}

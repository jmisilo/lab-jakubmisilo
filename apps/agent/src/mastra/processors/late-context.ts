import type { ProcessLLMRequestArgs } from '@mastra/core/processors';

export function insertContextBeforeLatestMessage(
  prompt: ProcessLLMRequestArgs['prompt'],
  content: string,
) {
  const insertionIndex = Math.max(prompt.length - 1, 0);

  return [
    ...prompt.slice(0, insertionIndex),
    {
      role: 'system' as const,
      content,
    },
    ...prompt.slice(insertionIndex),
  ];
}

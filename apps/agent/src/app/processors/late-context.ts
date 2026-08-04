import type { ProcessLLMRequestArgs } from '@mastra/core/processors';

export function insertContextBeforeLatestUserMessage(
  prompt: ProcessLLMRequestArgs['prompt'],
  content: string,
) {
  let insertionIndex = Math.max(prompt.length - 1, 0);

  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    if (prompt[index]?.role === 'user') {
      insertionIndex = index;
      break;
    }
  }

  return [
    ...prompt.slice(0, insertionIndex),
    {
      role: 'system' as const,
      content,
    },
    ...prompt.slice(insertionIndex),
  ];
}

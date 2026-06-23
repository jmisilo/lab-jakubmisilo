import { createUIMessageStream, createUIMessageStreamResponse, UIMessageChunk } from 'ai';

const MOCK_AI_WIDGET_RESULT = `France's second goal in the 81st minute was initiated when Kingsley Coman successfully tackled and dispossessed Lionel Messi. Coman then passed the ball to Adrien Rabiot, who sent a high pass forward to Kylian Mbappé. Mbappé headed the ball to Marcus Thuram, who immediately lobbed it back. Mbappé then struck a first-time right-footed volley past Emiliano Martínez into the net.`;

const MOCK_TOOL_OUTPUT_STATES = [
  [{ step: 'analyze-query', status: 'pending' }],
  [
    { step: 'analyze-query', status: 'done' },
    { step: 'locate-event', status: 'pending' },
  ],
  [
    { step: 'analyze-query', status: 'done' },
    { step: 'locate-event', status: 'done' },
    { step: 'retrieve-action-chain', status: 'pending' },
  ],
  [
    { step: 'analyze-query', status: 'done' },
    { step: 'locate-event', status: 'done' },
    { step: 'retrieve-action-chain', status: 'done' },
  ],
] satisfies Array<
  Array<{
    step: 'analyze-query' | 'locate-event' | 'retrieve-action-chain';
    status: 'done' | 'pending';
  }>
>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createMockAIWidgetStreamResponse = () => {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UIMessageChunk) => {
        writer.write(chunk);
      };

      const reasoningId = 'mock-reasoning-1';
      const secondReasoningId = 'mock-reasoning-2';
      const textId = 'mock-text-1';
      const toolCallId = 'mock-tool-call-1';

      await sleep(2309);

      write({ type: 'start' });
      write({ type: 'start-step' });
      write({ type: 'reasoning-start', id: reasoningId });
      write({
        type: 'reasoning-delta',
        id: reasoningId,
        delta: 'Inspecting match context and deciding which retrieval path to use.',
      });

      await sleep(3108);

      write({ type: 'reasoning-end', id: reasoningId });
      write({
        type: 'tool-input-available',
        toolCallId,
        toolName: 'retrieve-match-detail',
        input: {
          gameId: 'argentina-france-2022-final',
          query: 'France second goal action chain',
        },
      });

      for (const [index, steps] of MOCK_TOOL_OUTPUT_STATES.entries()) {
        write({
          type: 'tool-output-available',
          toolCallId,
          output: { steps },
          preliminary: index < MOCK_TOOL_OUTPUT_STATES.length - 1,
        });

        if (index < MOCK_TOOL_OUTPUT_STATES.length - 1) {
          await sleep(750 + Math.random() * 2000); // 750 - 2750 ms
        }
      }

      write({ type: 'finish-step' });

      await sleep(100 + Math.random() * 500); // 100 - 600 ms

      write({ type: 'start-step' });
      write({ type: 'reasoning-start', id: secondReasoningId });
      write({
        type: 'reasoning-delta',
        id: secondReasoningId,
        delta: 'Composing the answer from the retrieved action chain.',
      });

      await sleep(2503);

      write({ type: 'reasoning-end', id: secondReasoningId });
      write({ type: 'text-start', id: textId });

      for (const chunk of MOCK_AI_WIDGET_RESULT.split(/(\s+)/)) {
        if (chunk.length === 0) {
          continue;
        }

        write({ type: 'text-delta', id: textId, delta: chunk });

        await sleep(15 + Math.random() * 45); // 15 - 60 ms
      }

      write({ type: 'text-end', id: textId });
      write({ type: 'finish-step' });
      write({ type: 'finish', finishReason: 'stop' });
    },
  });

  return createUIMessageStreamResponse({ stream });
};

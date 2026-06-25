import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { zValidator } from '@hono/zod-validator';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai';
import { Hono } from 'hono';

import type { AIWidgetModel } from '@labjm/types/ai-widget';
import { tools } from '@labjm/ai/ai-widget';
import { AIChatRequestSchema } from '@labjm/schemas';

import { createMockAIWidgetStreamResponse } from './mock-response';

export const AIWidgetRouter = new Hono().post(
  '/ai-widget',
  zValidator('json', AIChatRequestSchema),
  async (c) => {
    const {
      messages: _messages,
      model = 'google-gemini-3.1-pro',
      thinkingIntensity = 'medium',
    } = c.req.valid('json');

    const messages = await validateUIMessages({ messages: _messages });

    /** @note on production, return a mock stream response to showcase the functionality only */
    if (process.env.NODE_ENV === 'production') {
      return createMockAIWidgetStreamResponse();
    }

    const result = streamText({
      messages: await convertToModelMessages(messages),
      system: "Answer user's requests about the football WC 2022 Argentina vs France final game.",
      tools,
      stopWhen: isStepCount(2),
      reasoning: thinkingIntensity,
      model: getModel({ model }),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
      }),
    });
  },
);

const getModel = ({
  model,
}: {
  model: AIWidgetModel;
}): Pick<Parameters<typeof streamText>[0], 'model'>['model'] => {
  if (model === 'openai-gpt-5.5') {
    return openai('gpt-5.5');
  }

  if (model === 'claude-opus-4.8') {
    return anthropic('claude-opus-4-8');
  }

  if (model === 'google-gemini-3.1-pro') {
    return google('gemini-pro-latest');
  }

  throw new Error('Unsupported model');
};

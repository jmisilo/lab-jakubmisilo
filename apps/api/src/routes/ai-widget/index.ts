import {
  anthropic,
  type AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic";
import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import {
  openai,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { zValidator } from "@hono/zod-validator";
import { tools } from "@labjm/ai/ai-widget";
import { AIChatRequestSchema } from "@labjm/schemas";
import type {
  AIWidgetModel,
  AIWidgetThinkingIntensity,
} from "@labjm/types/ai-widget";
import {
  createUIMessageStreamResponse,
  convertToModelMessages,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai";
import { Hono } from "hono";
import { createMockAIWidgetStreamResponse } from "./mock-response";

export const AIWidgetRouter = new Hono().post(
  "/ai-widget",
  zValidator("json", AIChatRequestSchema),
  async (c) => {
    const {
      messages: _messages,
      model = "google-gemini-3.1-pro",
      thinkingIntensity = "medium",
    } = c.req.valid("json");

    const messages = await validateUIMessages({ messages: _messages });

    /** @note on production, return a mock stream response to showcase the functionality only */
    if (process.env.NODE_ENV === "production") {
      return createMockAIWidgetStreamResponse();
    }

    const result = streamText({
      messages: await convertToModelMessages(messages),
      system:
        "Answer user's requests about the football WC 2022 Argentina vs France final game.",
      tools,
      stopWhen: isStepCount(2),
      ...getModelOptions({ model, thinkingIntensity }),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  },
);

const getModelOptions = ({
  model,
  thinkingIntensity,
}: {
  model: AIWidgetModel;
  thinkingIntensity: AIWidgetThinkingIntensity;
}): Pick<Parameters<typeof streamText>[0], "model" | "providerOptions"> => {
  if (model === "openai-gpt-5.5") {
    return {
      model: openai("gpt-5.5"),
      providerOptions: {
        openai: {
          reasoningEffort: thinkingIntensity,
          reasoningSummary: "auto",
        } satisfies OpenAILanguageModelResponsesOptions,
      },
    };
  }
  if (model === "claude-opus-4.8") {
    return {
      model: anthropic("claude-opus-4-8"),
      providerOptions: {
        anthropic: {
          effort: thinkingIntensity,
          thinking: { type: "adaptive", display: "summarized" },
        } satisfies AnthropicLanguageModelOptions,
      },
    };
  }

  if (model === "google-gemini-3.1-pro") {
    return {
      model: google("gemini-pro-latest"),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: thinkingIntensity,
            includeThoughts: true,
          },
        } satisfies GoogleLanguageModelOptions,
      },
    };
  }

  throw new Error("Unsupported model");
};

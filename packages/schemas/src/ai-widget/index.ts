import z from "zod/v4";

export const MatchDetailToolInputSchema = z
  .object({ query: z.string(), gameId: z.string() })
  .catch({ query: "test", gameId: "123" });

export const MatchDetailWorkflowStepSchema = z.enum([
  "analyze-query",
  "locate-event",
  "retrieve-action-chain",
]);

export const MatchDetailWorkflowStepStatusSchema = z.enum(["pending", "done"]);

export const MatchDetailToolOutputSchema = z.object({
  steps: z.array(
    z.object({
      step: MatchDetailWorkflowStepSchema,
      status: MatchDetailWorkflowStepStatusSchema,
    }),
  ),
  details: z.unknown().optional(),
});

export const AIWidgetModelSchema = z.enum([
  "openai-gpt-5.5",
  "claude-opus-4.8",
  "google-gemini-3.1-pro",
]);

export const AIWidgetThinkingIntensitySchema = z.enum([
  "low",
  "medium",
  "high",
]);

export const AIChatRequestSchema = z.object({
  messages: z.array(z.unknown()),
  model: AIWidgetModelSchema.optional(),
  thinkingIntensity: AIWidgetThinkingIntensitySchema.optional(),
});

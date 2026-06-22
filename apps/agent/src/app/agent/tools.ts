import { tool, type Tool } from "ai";
import { z } from "zod/v4";

import { AgentMemoryService } from "@/app/memory";
import { logger } from "@/infrastructure/logger";

export const CreateNotedMemoryToolInputSchema = z.object({
  content: z.string().describe("The concise durable memory to save."),
  kind: z
    .string()
    .optional()
    .describe(
      "A short category for the memory, for example preference, fact, task, project, or note.",
    ),
  importance: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Importance from 1 to 5. Use 1 by default."),
});

export const CreateNotedMemoryToolOutputSchema = z.object({
  id: z.string().nullable(),
  saved: z.boolean(),
});

export const CreateNotedMemoryToolContextSchema = z.object({
  identityId: z.string(),
});

type CreateNotedMemoryInput = z.infer<typeof CreateNotedMemoryToolInputSchema>;
type CreateNotedMemoryOutput = z.infer<
  typeof CreateNotedMemoryToolOutputSchema
>;
type CreateNotedMemoryContext = z.infer<
  typeof CreateNotedMemoryToolContextSchema
>;
type CreateNotedMemoryTool = Tool<
  CreateNotedMemoryInput,
  CreateNotedMemoryOutput,
  CreateNotedMemoryContext
> & {
  execute: NonNullable<
    Tool<
      CreateNotedMemoryInput,
      CreateNotedMemoryOutput,
      CreateNotedMemoryContext
    >["execute"]
  >;
};

export const createNotedMemoryTool: CreateNotedMemoryTool = tool<
  CreateNotedMemoryInput,
  CreateNotedMemoryOutput,
  CreateNotedMemoryContext
>({
  description:
    "Persist durable information the assistant should remember for future conversations. Use for explicit remember/note requests, stable user preferences, durable personal facts, and important project context. Do not use for transient conversation details.",
  inputSchema: CreateNotedMemoryToolInputSchema,
  outputSchema: CreateNotedMemoryToolOutputSchema,
  contextSchema: CreateNotedMemoryToolContextSchema,
  inputExamples: [
    {
      input: {
        content: "The user prefers concise implementation-focused updates.",
        kind: "preference",
        importance: 3,
      },
    },
  ],
  execute: async ({ content, kind = "note", importance = 1 }, { context }) => {
    const memory = await AgentMemoryService.recordNotedInfo({
      identityId: context.identityId,
      content,
      kind,
      importance,
      metadata: {
        source: "agent_tool",
      },
    });

    logger.info(
      {
        identityId: context.identityId,
        memoryId: memory?.id,
        kind,
        importance,
      },
      "[AGENT_MEMORY]: noted memory created",
    );

    return {
      id: memory?.id ?? null,
      saved: Boolean(memory),
    };
  },
});

export type AgentTools = {
  "create-noted-memory": CreateNotedMemoryTool;
};

export const agentTools: AgentTools = {
  "create-noted-memory": createNotedMemoryTool,
};

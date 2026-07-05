import { z } from 'zod';

export const ManageKnowledgeToolContextSchema = z.object({
  identityId: z.string().min(1),
  sourceMessageId: z.string().optional(),
});

const KnowledgeNodePathSchema = z
  .string()
  .min(1)
  .describe(
    "Slash-separated knowledge path, for example 'profile/location' or 'projects/project-alpha/design-system'. Do not include a leading slash.",
  );

const KnowledgeNodeDraftSchema = z.object({
  parentPath: KnowledgeNodePathSchema.optional().describe(
    'Optional parent path. Missing parent groups are auto-created. Omit it to create a root-level note.',
  ),
  slug: z
    .string()
    .min(1)
    .optional()
    .describe('Optional URL-safe slug for the note path. Omit it unless a stable slug is obvious.'),
  title: z.string().min(1).describe('Human-readable note title.'),
  content: z
    .string()
    .min(1)
    .describe('Markdown note content. Preserve durable facts, preferences, decisions, or history.'),
});

export const ManageKnowledgeToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create').describe('Create a new durable note.'),
    node: KnowledgeNodeDraftSchema.describe("Node draft for 'create'."),
  }),
  z.object({
    action: z.literal('update').describe('Update an existing active note.'),
    path: KnowledgeNodePathSchema.describe("Existing active node path for 'update'."),
    update: z
      .object({
        title: z.string().min(1).optional().describe('Optional updated title.'),
        content: z.string().min(1).describe('Updated markdown note content.'),
      })
      .describe("Updated note data for 'update'."),
  }),
  z.object({
    action: z
      .literal('supersede')
      .describe('Mark an old active note inactive while preserving it as history.'),
    path: KnowledgeNodePathSchema.describe("Existing active node path for 'supersede'."),
    node: KnowledgeNodeDraftSchema.optional().describe(
      'Optional replacement node draft when a new active fact should replace the old one.',
    ),
    supersededByPath: KnowledgeNodePathSchema.optional().describe(
      "Optional existing active replacement path for 'supersede'. Use this instead of node when the replacement already exists.",
    ),
  }),
]);

const KnowledgeToolNodeSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  active: z.boolean(),
});

export const ManageKnowledgeToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  operationId: z.string().optional(),
  node: KnowledgeToolNodeSchema.optional(),
  supersededNode: KnowledgeToolNodeSchema.optional(),
});

export const ImplicitKnowledgeExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        parentPath: KnowledgeNodePathSchema.nullish().transform((value) => value ?? undefined),
        slug: z.string().min(1).optional(),
        title: z.string().min(1),
        content: z.string().min(1),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(1).optional(),
      }),
    )
    .max(5),
});

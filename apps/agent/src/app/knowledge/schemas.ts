import { z } from 'zod';

export const KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS = 180;
export const KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS = 20_000;
export const IMPLICIT_KNOWLEDGE_CONTENT_MAX_CHARACTERS = 2_000;
export const KNOWLEDGE_TOOL_LIST_MAX_ITEMS = 50;
export const KNOWLEDGE_TOOL_EXPLORE_MAX_ITEMS = 30;
export const KNOWLEDGE_TOOL_EXPLORE_MAX_DEPTH = 5;

export const ManageKnowledgeToolContextSchema = z.object({
  identityId: z.string().min(1),
  sourceMessageId: z.string().optional(),
});
export const ReadKnowledgeToolContextSchema = ManageKnowledgeToolContextSchema;

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
  title: z
    .string()
    .min(1)
    .max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS)
    .describe('Human-readable note title. Keep it specific and concise.'),
  content: z
    .string()
    .min(1)
    .max(KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS)
    .describe(
      `Markdown note content. Preserve durable facts, preferences, decisions, history, project notes, ideas, or journal entries. Maximum ${KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS} characters; if the user provides more, ask to split it into multiple notes.`,
    ),
});

export const KnowledgeExploreDirectionSchema = z.enum([
  'auto',
  'children',
  'descendants',
  'ancestors',
  'siblings',
  'neighborhood',
]);

export const ReadKnowledgeToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list').describe('List direct child notes under a parent path.'),
    parentPath: KnowledgeNodePathSchema.optional().describe(
      'Optional parent path to list. Omit it to list root-level notes.',
    ),
    includeInactive: z
      .boolean()
      .optional()
      .describe('Whether to include inactive/superseded notes. Defaults to false.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(KNOWLEDGE_TOOL_LIST_MAX_ITEMS)
      .optional()
      .describe(`Maximum notes to return. Defaults to ${KNOWLEDGE_TOOL_LIST_MAX_ITEMS}.`),
  }),
  z.object({
    action: z.literal('read').describe('Read one existing knowledge note by path.'),
    path: KnowledgeNodePathSchema.describe("Existing node path for 'read'."),
    includeInactive: z
      .boolean()
      .optional()
      .describe('Whether an inactive/superseded note may be read. Defaults to false.'),
  }),
  z.object({
    action: z
      .literal('explore')
      .describe(
        'Explore related notes around a start path or query without loading full note content.',
      ),
    startPath: KnowledgeNodePathSchema.optional().describe(
      'Optional existing note path to explore from. Use this when a relevant path is known.',
    ),
    query: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Optional topic to find a useful start note or rank explored notes. Provide this for broad topic questions.',
      ),
    direction: KnowledgeExploreDirectionSchema.optional().describe(
      "Traversal direction. Defaults to 'auto'. Use descendants for deeper project/topic notes, ancestors for parent context, and neighborhood for nearby context.",
    ),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(KNOWLEDGE_TOOL_EXPLORE_MAX_DEPTH)
      .optional()
      .describe(
        `Maximum tree distance from the start note. Defaults to 2 and cannot exceed ${KNOWLEDGE_TOOL_EXPLORE_MAX_DEPTH}.`,
      ),
    includeInactive: z
      .boolean()
      .optional()
      .describe('Whether inactive/superseded notes may be explored. Defaults to false.'),
    includeContentPreview: z
      .boolean()
      .optional()
      .describe('Whether to include capped note content previews. Defaults to true.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(KNOWLEDGE_TOOL_EXPLORE_MAX_ITEMS)
      .optional()
      .describe(`Maximum explored notes to return. Defaults to 12.`),
  }),
]);

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
        title: z
          .string()
          .min(1)
          .max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS)
          .optional()
          .describe('Optional updated title. Keep it specific and concise.'),
        content: z
          .string()
          .min(1)
          .max(KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS)
          .describe(
            `Updated complete standalone markdown note content. Maximum ${KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS} characters.`,
          ),
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
  z.object({
    action: z
      .literal('deactivate')
      .describe(
        'Mark an active note inactive without deleting it. Use for forget/archive requests.',
      ),
    path: KnowledgeNodePathSchema.describe("Existing active node path for 'deactivate'."),
  }),
  z.object({
    action: z
      .literal('move')
      .describe('Move and/or rename an active note path while preserving its subtree.'),
    path: KnowledgeNodePathSchema.describe("Existing active node path for 'move'."),
    move: z
      .object({
        parentPath: KnowledgeNodePathSchema.nullable()
          .optional()
          .describe('New parent path. Use null to move to root. Omit to keep the same parent.'),
        slug: z
          .string()
          .min(1)
          .optional()
          .describe('Optional new path slug. Omit to keep the current slug.'),
        title: z
          .string()
          .min(1)
          .max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS)
          .optional()
          .describe('Optional updated note title. Omit to keep the current title.'),
      })
      .describe("Move/rename data for 'move'."),
  }),
]);

const KnowledgeToolNodeSchema = z.object({
  id: z.string(),
  path: z.string(),
  parentPath: z.string().nullable().optional(),
  title: z.string(),
  content: z.string().optional(),
  contentPreview: z.string().optional(),
  relationship: z.enum(['start', 'ancestor', 'child', 'descendant', 'sibling']).optional(),
  depthFromStart: z.number().int().optional(),
  childCount: z.number().int().min(0).optional(),
  active: z.boolean(),
});

export const ManageKnowledgeToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  operationId: z.string().optional(),
  node: KnowledgeToolNodeSchema.optional(),
  nodes: z.array(KnowledgeToolNodeSchema).optional(),
  supersededNode: KnowledgeToolNodeSchema.optional(),
  truncated: z.boolean().optional(),
  startPaths: z.array(z.string()).optional(),
  suggestedNextPaths: z.array(z.string()).optional(),
});
export const ReadKnowledgeToolOutputSchema = ManageKnowledgeToolOutputSchema;

export const ImplicitKnowledgeExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        parentPath: KnowledgeNodePathSchema.nullish().transform((value) => value ?? undefined),
        slug: z
          .string()
          .min(1)
          .nullish()
          .transform((value) => value ?? undefined),
        title: z.string().min(1).max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS),
        content: z.string().min(1).max(IMPLICIT_KNOWLEDGE_CONTENT_MAX_CHARACTERS),
        confidence: z.number().min(0).max(1),
        reason: z
          .string()
          .min(1)
          .nullish()
          .transform((value) => value ?? undefined),
      }),
    )
    .max(5),
});

export const ImplicitKnowledgeExtractionModelOutputSchema = z.object({
  items: z
    .array(
      z.object({
        parentPath: KnowledgeNodePathSchema.nullable(),
        slug: z.string().min(1).nullable(),
        title: z.string().min(1).max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS),
        content: z.string().min(1).max(IMPLICIT_KNOWLEDGE_CONTENT_MAX_CHARACTERS),
        confidence: z.number().min(0).max(1),
        reason: z.string().min(1).nullable(),
      }),
    )
    .max(5),
});

export const ImplicitKnowledgeIngestionDecisionSchema = z.object({
  action: z.enum(['skip', 'update', 'supersede', 'create']),
  targetPath: KnowledgeNodePathSchema.nullish().transform((value) => value ?? undefined),
  parentPath: KnowledgeNodePathSchema.nullish().transform((value) => value ?? undefined),
  slug: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? undefined),
  title: z
    .string()
    .min(1)
    .max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS)
    .nullish()
    .transform((value) => value ?? undefined),
  content: z
    .string()
    .min(1)
    .max(KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS)
    .nullish()
    .transform((value) => value ?? undefined),
  reason: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? undefined),
});

export const ImplicitKnowledgeIngestionDecisionModelOutputSchema = z.object({
  action: z.enum(['skip', 'update', 'supersede', 'create']),
  targetPath: KnowledgeNodePathSchema.nullable(),
  parentPath: KnowledgeNodePathSchema.nullable(),
  slug: z.string().min(1).nullable(),
  title: z.string().min(1).max(KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS).nullable(),
  content: z.string().min(1).max(KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS).nullable(),
  reason: z.string().min(1).nullable(),
});

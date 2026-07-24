import { z } from 'zod';

const KnowledgePathSchema = z
  .string()
  .min(1)
  .max(500)
  .describe('Slash-separated knowledge path, such as preferences/communication.');

export const ReadKnowledgeInputSchema = z.object({
  action: z.enum(['search', 'read', 'list', 'explore']),
  query: z.string().min(1).max(2_000).optional(),
  path: KnowledgePathSchema.optional(),
  parentPath: KnowledgePathSchema.optional(),
  direction: z.enum(['ancestors', 'children', 'descendants', 'both']).optional(),
  depth: z.number().int().min(1).max(5).optional(),
});

export const ReadKnowledgeRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    query: z.string().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('read'),
    path: KnowledgePathSchema,
  }),
  z.object({
    action: z.literal('list'),
    parentPath: KnowledgePathSchema.optional(),
  }),
  z.object({
    action: z.literal('explore'),
    path: KnowledgePathSchema,
    direction: z.enum(['ancestors', 'children', 'descendants', 'both']).default('both'),
    depth: z.number().int().min(1).max(5).default(2),
  }),
]);

export const ManageKnowledgeInputSchema = z.object({
  action: z.enum(['create', 'update', 'move', 'deactivate']),
  path: KnowledgePathSchema.optional(),
  title: z.string().min(1).max(180).optional(),
  content: z.string().min(1).max(20_000).optional(),
  destinationPath: KnowledgePathSchema.optional(),
});

export const ManageKnowledgeRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    path: KnowledgePathSchema,
    title: z.string().min(1).max(180),
    content: z.string().min(1).max(20_000),
  }),
  z.object({
    action: z.literal('update'),
    path: KnowledgePathSchema,
    title: z.string().min(1).max(180).optional(),
    content: z.string().min(1).max(20_000),
  }),
  z.object({
    action: z.literal('move'),
    path: KnowledgePathSchema,
    destinationPath: KnowledgePathSchema,
  }),
  z.object({
    action: z.literal('deactivate'),
    path: KnowledgePathSchema,
  }),
]);

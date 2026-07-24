import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const knowledgeNodes = pgTable(
  'agent_rebuild_knowledge_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => knowledgeNodes.id, {
      onDelete: 'restrict',
    }),
    path: text('path').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    active: boolean('active').notNull().default(true),
    supersededById: uuid('superseded_by_id').references((): AnyPgColumn => knowledgeNodes.id, {
      onDelete: 'set null',
    }),
    source: text('source', { enum: ['agent', 'explicit', 'implicit'] })
      .notNull()
      .default('agent'),
    sourceMessageId: text('source_message_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_rebuild_knowledge_nodes_active_path_idx')
      .on(table.identityId, table.path)
      .where(sql`${table.active} = true`),
    index('agent_rebuild_knowledge_nodes_identity_parent_idx').on(table.identityId, table.parentId),
    index('agent_rebuild_knowledge_nodes_identity_active_idx').on(table.identityId, table.active),
    index('agent_rebuild_knowledge_nodes_embedding_idx')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .where(sql`${table.active} = true`),
    check(
      'agent_rebuild_knowledge_nodes_title_length_check',
      sql`char_length(${table.title}) <= 180`,
    ),
    check(
      'agent_rebuild_knowledge_nodes_content_length_check',
      sql`char_length(${table.content}) <= 20000`,
    ),
  ],
);

export const knowledgeNodeClosure = pgTable(
  'agent_rebuild_knowledge_node_closure',
  {
    identityId: text('identity_id').notNull(),
    ancestorId: uuid('ancestor_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    descendantId: uuid('descendant_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'agent_rebuild_knowledge_node_closure_pk',
      columns: [table.ancestorId, table.descendantId],
    }),
    index('agent_rebuild_knowledge_node_closure_ancestor_idx').on(
      table.identityId,
      table.ancestorId,
      table.depth,
    ),
    index('agent_rebuild_knowledge_node_closure_descendant_idx').on(
      table.identityId,
      table.descendantId,
      table.depth,
    ),
    check('agent_rebuild_knowledge_node_closure_depth_check', sql`${table.depth} >= 0`),
  ],
);

export const oneTimeSchedules = pgTable(
  'agent_rebuild_one_time_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceId: text('resource_id').notNull(),
    threadId: text('thread_id').notNull(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    status: text('status', {
      enum: ['active', 'running', 'completed', 'cancelled', 'failed'],
    })
      .notNull()
      .default('active'),
    qstashMessageId: text('qstash_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_rebuild_one_time_schedules_owner_idx').on(
      table.resourceId,
      table.status,
      table.runAt,
    ),
    check(
      'agent_rebuild_one_time_schedules_title_length_check',
      sql`char_length(${table.title}) <= 180`,
    ),
    check(
      'agent_rebuild_one_time_schedules_prompt_length_check',
      sql`char_length(${table.prompt}) <= 4000`,
    ),
  ],
);

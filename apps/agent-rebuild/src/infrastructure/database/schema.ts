import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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
      enum: ['active', 'paused', 'running', 'completed', 'cancelled', 'failed'],
    })
      .notNull()
      .default('active'),
    qstashMessageId: text('qstash_message_id'),
    revision: integer('revision').notNull().default(1),
    executionStartedAt: timestamp('execution_started_at', { withTimezone: true }),
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

export const scheduleOccurrenceCompletions = pgTable(
  'agent_rebuild_schedule_occurrence_completions',
  {
    scheduleId: text('schedule_id').notNull(),
    resourceId: text('resource_id').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'agent_rebuild_schedule_occurrence_completions_pk',
      columns: [table.scheduleId, table.localDate],
    }),
    index('agent_rebuild_schedule_occurrence_completions_owner_idx').on(
      table.resourceId,
      table.localDate,
    ),
  ],
);

export const googleOauthStates = pgTable(
  'agent_rebuild_google_oauth_states',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: text('request_id').notNull(),
    stateHash: text('state_hash').notNull(),
    resourceId: text('resource_id').notNull(),
    threadId: text('thread_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_rebuild_google_oauth_states_request_idx').on(table.requestId),
    uniqueIndex('agent_rebuild_google_oauth_states_hash_idx').on(table.stateHash),
    index('agent_rebuild_google_oauth_states_expiry_idx').on(table.expiresAt),
  ],
);

export const googleConnections = pgTable(
  'agent_rebuild_google_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceId: text('resource_id').notNull(),
    status: text('status', { enum: ['active', 'invalid', 'revoked'] })
      .notNull()
      .default('active'),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    refreshTokenIv: text('refresh_token_iv').notNull(),
    refreshTokenAuthTag: text('refresh_token_auth_tag').notNull(),
    grantedScopes: text('granted_scopes').array().notNull().default([]),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_rebuild_google_connections_active_idx')
      .on(table.resourceId)
      .where(sql`${table.status} = 'active'`),
    index('agent_rebuild_google_connections_owner_idx').on(table.resourceId, table.status),
  ],
);

export const nutritionProfiles = pgTable(
  'agent_rebuild_nutrition_profiles',
  {
    resourceId: text('resource_id').primaryKey(),
    dailyCaloriesGoal: integer('daily_calories_goal').notNull(),
    dailyProteinGoalGrams: real('daily_protein_goal_grams'),
    dailyCarbsGoalGrams: real('daily_carbs_goal_grams'),
    dailyFatGoalGrams: real('daily_fat_goal_grams'),
    dailyFiberGoalGrams: real('daily_fiber_goal_grams'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'agent_rebuild_nutrition_profiles_calories_check',
      sql`${table.dailyCaloriesGoal} between 500 and 10000`,
    ),
  ],
);

export const nutritionMeals = pgTable(
  'agent_rebuild_nutrition_meals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceId: text('resource_id').notNull(),
    threadId: text('thread_id').notNull(),
    status: text('status', { enum: ['draft', 'confirmed', 'deleted'] })
      .notNull()
      .default('draft'),
    name: text('name').notNull(),
    items: jsonb('items').$type<Record<string, unknown>[]>().notNull(),
    source: text('source', { enum: ['photo', 'text', 'manual'] }).notNull(),
    calories: integer('calories').notNull(),
    caloriesMin: integer('calories_min'),
    caloriesMax: integer('calories_max'),
    proteinGrams: real('protein_grams').notNull(),
    carbsGrams: real('carbs_grams').notNull(),
    fatGrams: real('fat_grams').notNull(),
    fiberGrams: real('fiber_grams').notNull(),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    eatenAt: timestamp('eaten_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_rebuild_nutrition_meals_draft_idx')
      .on(table.resourceId, table.threadId)
      .where(sql`${table.status} = 'draft'`),
    index('agent_rebuild_nutrition_meals_daily_idx').on(
      table.resourceId,
      table.localDate,
      table.status,
    ),
    check(
      'agent_rebuild_nutrition_meals_calories_check',
      sql`${table.calories} between 0 and 20000`,
    ),
  ],
);

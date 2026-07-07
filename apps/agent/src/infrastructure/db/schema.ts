import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

type WorldCup2026EventType = 'kickoff' | 'goal' | 'game-end';
type AgentKnowledgeSource = 'explicit' | 'implicit' | 'system';

/**
 * Chat SDK owns chat_state_* tables. Drizzle excludes those tables from db:push,
 * but their bigserial backing sequences are still visible in public, so keep the
 * sequences declared to prevent accidental drops.
 */
export const chatStateListsSeq = pgSequence('chat_state_lists_seq_seq');
export const chatStateQueuesSeq = pgSequence('chat_state_queues_seq_seq');

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    sourceMessageId: text('source_message_id'),
    compressedAt: timestamp('compressed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_messages_identity_thread_created_at_idx').on(
      table.identityId,
      table.threadId,
      table.createdAt,
    ),
    index('agent_messages_uncompressed_idx').on(
      table.identityId,
      table.threadId,
      table.compressedAt,
    ),
  ],
);

export const agentMemoryChunks = pgTable(
  'agent_memory_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    sourceMessageIds: uuid('source_message_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_memory_chunks_identity_created_at_idx').on(table.identityId, table.createdAt),
    index('agent_memory_chunks_thread_created_at_idx').on(table.threadId, table.createdAt),
  ],
);

export const agentKnowledgeNodes = pgTable(
  'agent_knowledge_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => agentKnowledgeNodes.id, {
      onDelete: 'set null',
    }),
    slug: text('slug').notNull(),
    path: text('path').notNull(),
    depth: integer('depth').notNull().default(0),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    active: boolean('active').notNull().default(true),
    supersededById: uuid('superseded_by_id').references((): AnyPgColumn => agentKnowledgeNodes.id, {
      onDelete: 'set null',
    }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    source: text('source', { enum: ['explicit', 'implicit', 'system'] })
      .notNull()
      .default('explicit')
      .$type<AgentKnowledgeSource>(),
    sourceMessageId: text('source_message_id'),
    metadata: jsonb('metadata').notNull().default({}),
    embedding: vector('embedding', { dimensions: 1536 }),
    embeddingModel: text('embedding_model'),
    embeddingContentHash: text('embedding_content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_knowledge_nodes_active_path_idx')
      .on(table.identityId, table.path)
      .where(sql`${table.active} = true`),
    index('agent_knowledge_nodes_identity_parent_idx').on(table.identityId, table.parentId),
    index('agent_knowledge_nodes_identity_active_idx').on(table.identityId, table.active),
    index('agent_knowledge_nodes_superseded_by_idx').on(table.supersededById),
    index('agent_knowledge_nodes_embedding_idx')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .where(sql`${table.embedding} is not null`),
    check('agent_knowledge_nodes_title_length_check', sql`char_length(${table.title}) <= 180`),
    check(
      'agent_knowledge_nodes_content_length_check',
      sql`char_length(${table.content}) <= 20000`,
    ),
  ],
);

export const agentKnowledgeNodeClosure = pgTable(
  'agent_knowledge_node_closure',
  {
    identityId: text('identity_id').notNull(),
    ancestorId: uuid('ancestor_id')
      .notNull()
      .references(() => agentKnowledgeNodes.id, { onDelete: 'cascade' }),
    descendantId: uuid('descendant_id')
      .notNull()
      .references(() => agentKnowledgeNodes.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.ancestorId, table.descendantId],
      name: 'agent_knowledge_node_closure_pk',
    }),
    index('agent_knowledge_node_closure_ancestor_idx').on(
      table.identityId,
      table.ancestorId,
      table.depth,
    ),
    index('agent_knowledge_node_closure_descendant_idx').on(
      table.identityId,
      table.descendantId,
      table.depth,
    ),
  ],
);

export const agentScheduledTasks = pgTable(
  'agent_scheduled_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id').notNull(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    scheduleKind: text('schedule_kind', { enum: ['one_time', 'recurring'] }).notNull(),
    status: text('status', { enum: ['active', 'completed', 'cancelled', 'failed'] })
      .notNull()
      .default('active'),
    timeZone: text('time_zone').notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    recurrence: jsonb('recurrence').notNull().default({}),
    qstashMessageId: text('qstash_message_id'),
    qstashScheduleId: text('qstash_schedule_id'),
    sourceMessageId: text('source_message_id'),
    metadata: jsonb('metadata').notNull().default({}),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_scheduled_tasks_due_idx').on(table.status, table.nextRunAt),
    index('agent_scheduled_tasks_qstash_message_idx').on(table.qstashMessageId),
    index('agent_scheduled_tasks_qstash_schedule_idx').on(table.qstashScheduleId),
    index('agent_scheduled_tasks_identity_thread_idx').on(
      table.identityId,
      table.threadId,
      table.status,
    ),
    check('agent_scheduled_tasks_title_length_check', sql`char_length(${table.title}) <= 180`),
    check('agent_scheduled_tasks_prompt_length_check', sql`char_length(${table.prompt}) <= 4000`),
  ],
);

export const agentScheduledTaskRuns = pgTable(
  'agent_scheduled_task_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => agentScheduledTasks.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['running', 'sent', 'failed'] })
      .notNull()
      .default('running'),
    output: text('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_scheduled_task_runs_task_scheduled_for_idx').on(
      table.taskId,
      table.scheduledFor,
    ),
    index('agent_scheduled_task_runs_task_idx').on(table.taskId),
    index('agent_scheduled_task_runs_status_idx').on(table.status),
  ],
);

export const worldCup2026Subscriptions = pgTable(
  'world_cup_2026_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id').notNull(),
    scope: text('scope', { enum: ['team'] }).notNull(),
    teamId: text('team_id'),
    teamName: text('team_name'),
    eventTypes: text('event_types', { enum: ['kickoff', 'goal', 'game-end'] })
      .array()
      .notNull()
      .default([])
      .$type<WorldCup2026EventType[]>(),
    active: boolean('active').notNull().default(true),
    sourceMessageId: text('source_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('world_cup_2026_subscriptions_active_idx').on(table.active),
    index('world_cup_2026_subscriptions_thread_idx').on(table.threadId),
    index('world_cup_2026_subscriptions_team_idx').on(table.teamId),
  ],
);

export const worldCup2026GameSnapshots = pgTable('world_cup_2026_game_snapshots', {
  gameId: text('game_id').primaryKey(),
  homeTeamId: text('home_team_id').notNull(),
  awayTeamId: text('away_team_id').notNull(),
  homeTeamName: text('home_team_name').notNull(),
  awayTeamName: text('away_team_name').notNull(),
  homeScore: integer('home_score').notNull(),
  awayScore: integer('away_score').notNull(),
  homeScorers: text('home_scorers').notNull(),
  awayScorers: text('away_scorers').notNull(),
  finished: boolean('finished').notNull(),
  timeElapsed: text('time_elapsed').notNull(),
  localDate: text('local_date').notNull(),
  raw: jsonb('raw').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const worldCup2026DetectedEvents = pgTable(
  'world_cup_2026_detected_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventKey: text('event_key').notNull(),
    eventType: text('event_type', {
      enum: ['kickoff-reminder', 'kickoff', 'goal', 'game-end'],
    }).notNull(),
    gameId: text('game_id').notNull(),
    teamIds: text('team_ids').array().notNull().default([]),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('world_cup_2026_detected_events_event_key_idx').on(table.eventKey),
    index('world_cup_2026_detected_events_game_idx').on(table.gameId),
  ],
);

export const worldCup2026EventDeliveries = pgTable(
  'world_cup_2026_event_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryKey: text('delivery_key').notNull(),
    eventKey: text('event_key').notNull(),
    subscriptionId: uuid('subscription_id').notNull(),
    threadId: text('thread_id').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('world_cup_2026_event_deliveries_delivery_key_idx').on(table.deliveryKey),
    index('world_cup_2026_event_deliveries_event_idx').on(table.eventKey),
    index('world_cup_2026_event_deliveries_thread_idx').on(table.threadId),
  ],
);

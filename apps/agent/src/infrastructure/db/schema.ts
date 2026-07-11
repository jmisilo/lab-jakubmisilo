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
    status: text('status', { enum: ['active', 'paused', 'completed', 'cancelled', 'failed'] })
      .notNull()
      .default('active'),
    revision: integer('revision').notNull().default(1),
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
    triggerVersion: text('trigger_version').notNull().default('legacy'),
    status: text('status', { enum: ['running', 'sent', 'failed', 'satisfied', 'skipped'] })
      .notNull()
      .default('running'),
    claimToken: text('claim_token'),
    sourceMessageId: text('source_message_id'),
    output: text('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_scheduled_task_runs_task_scheduled_for_idx').on(
      table.taskId,
      table.scheduledFor,
      table.triggerVersion,
    ),
    index('agent_scheduled_task_runs_task_idx').on(table.taskId),
    index('agent_scheduled_task_runs_status_idx').on(table.status),
  ],
);

export const agentNutritionProfiles = pgTable(
  'agent_nutrition_profiles',
  {
    identityId: text('identity_id').primaryKey(),
    dailyCaloriesGoal: integer('daily_calories_goal').notNull(),
    dailyProteinGoalGrams: real('daily_protein_goal_grams'),
    dailyCarbsGoalGrams: real('daily_carbs_goal_grams'),
    dailyFatGoalGrams: real('daily_fat_goal_grams'),
    dailyFiberGoalGrams: real('daily_fiber_goal_grams'),
    sourceMessageId: text('source_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'agent_nutrition_profiles_calories_goal_check',
      sql`${table.dailyCaloriesGoal} between 500 and 10000`,
    ),
    check(
      'agent_nutrition_profiles_protein_goal_check',
      sql`${table.dailyProteinGoalGrams} is null or ${table.dailyProteinGoalGrams} between 0 and 1000`,
    ),
    check(
      'agent_nutrition_profiles_carbs_goal_check',
      sql`${table.dailyCarbsGoalGrams} is null or ${table.dailyCarbsGoalGrams} between 0 and 2000`,
    ),
    check(
      'agent_nutrition_profiles_fat_goal_check',
      sql`${table.dailyFatGoalGrams} is null or ${table.dailyFatGoalGrams} between 0 and 1000`,
    ),
    check(
      'agent_nutrition_profiles_fiber_goal_check',
      sql`${table.dailyFiberGoalGrams} is null or ${table.dailyFiberGoalGrams} between 0 and 500`,
    ),
  ],
);

export const agentNutritionMeals = pgTable(
  'agent_nutrition_meals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id').notNull(),
    status: text('status', { enum: ['draft', 'confirmed', 'deleted'] })
      .notNull()
      .default('draft'),
    name: text('name').notNull(),
    items: jsonb('items').$type<NutritionMealItemStorage[]>().notNull(),
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
    idempotencyKey: text('idempotency_key').notNull(),
    sourceMessageId: text('source_message_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_nutrition_meals_identity_idempotency_idx').on(
      table.identityId,
      table.idempotencyKey,
    ),
    uniqueIndex('agent_nutrition_meals_active_draft_idx')
      .on(table.identityId, table.threadId)
      .where(sql`${table.status} = 'draft'`),
    index('agent_nutrition_meals_daily_idx').on(table.identityId, table.localDate, table.status),
    check('agent_nutrition_meals_name_length_check', sql`char_length(${table.name}) <= 180`),
    check('agent_nutrition_meals_calories_check', sql`${table.calories} between 0 and 20000`),
    check(
      'agent_nutrition_meals_calories_range_check',
      sql`(${table.caloriesMin} is null or ${table.caloriesMin} between 0 and ${table.calories}) and (${table.caloriesMax} is null or ${table.caloriesMax} between ${table.calories} and 20000)`,
    ),
    check(
      'agent_nutrition_meals_macros_check',
      sql`${table.proteinGrams} between 0 and 2000 and ${table.carbsGrams} between 0 and 3000 and ${table.fatGrams} between 0 and 2000 and ${table.fiberGrams} between 0 and 1000`,
    ),
  ],
);

export const agentGoogleCalendarOauthStates = pgTable(
  'agent_google_calendar_oauth_states',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: text('request_id').notNull(),
    stateHash: text('state_hash').notNull(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id').notNull(),
    sourceMessageId: text('source_message_id'),
    scopes: text('scopes').array().notNull().default([]),
    redirectPath: text('redirect_path'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_google_calendar_oauth_states_request_idx').on(table.requestId),
    uniqueIndex('agent_google_calendar_oauth_states_hash_idx').on(table.stateHash),
    index('agent_google_calendar_oauth_states_identity_thread_expires_idx').on(
      table.identityId,
      table.threadId,
      table.expiresAt,
    ),
  ],
);

export const agentGoogleCalendarConnections = pgTable(
  'agent_google_calendar_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    status: text('status', { enum: ['active', 'revoked', 'invalid'] })
      .notNull()
      .default('active'),
    googleAccountEmail: text('google_account_email'),
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    refreshTokenIv: text('refresh_token_iv').notNull(),
    refreshTokenAuthTag: text('refresh_token_auth_tag').notNull(),
    grantedScopes: text('granted_scopes').array().notNull().default([]),
    defaultCalendarId: text('default_calendar_id'),
    metadata: jsonb('metadata').notNull().default({}),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_google_calendar_connections_active_identity_idx')
      .on(table.identityId)
      .where(sql`${table.status} = 'active'`),
    index('agent_google_calendar_connections_identity_status_idx').on(
      table.identityId,
      table.status,
    ),
  ],
);

export const agentGoogleCalendarActionAudit = pgTable(
  'agent_google_calendar_action_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    identityId: text('identity_id').notNull(),
    threadId: text('thread_id'),
    sourceMessageId: text('source_message_id'),
    action: text('action').notNull(),
    calendarId: text('calendar_id'),
    eventId: text('event_id'),
    status: text('status', { enum: ['succeeded', 'failed'] }).notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_google_calendar_action_audit_identity_created_idx').on(
      table.identityId,
      table.createdAt,
    ),
    index('agent_google_calendar_action_audit_event_idx').on(table.calendarId, table.eventId),
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

type WorldCup2026EventType = 'kickoff' | 'goal' | 'game-end';
type AgentKnowledgeSource = 'explicit' | 'implicit' | 'system';
type NutritionMealItemStorage = {
  name: string;
  estimatedGrams: number;
  preparationMethod: string;
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  fiberGrams: number;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
};

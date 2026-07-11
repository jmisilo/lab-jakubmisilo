-- Chat SDK creates and owns chat_state_* tables and their backing sequences.
CREATE TABLE "agent_google_calendar_action_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text,
	"source_message_id" text,
	"action" text NOT NULL,
	"calendar_id" text,
	"event_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_google_calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"google_account_email" text,
	"encrypted_refresh_token" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_auth_tag" text NOT NULL,
	"granted_scopes" text[] DEFAULT '{}' NOT NULL,
	"default_calendar_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_google_calendar_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"source_message_id" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"redirect_path" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_knowledge_node_closure" (
	"identity_id" text NOT NULL,
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_knowledge_node_closure_pk" PRIMARY KEY("ancestor_id","descendant_id")
);
--> statement-breakpoint
CREATE TABLE "agent_knowledge_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"source" text DEFAULT 'explicit' NOT NULL,
	"source_message_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_knowledge_nodes_title_length_check" CHECK (char_length("agent_knowledge_nodes"."title") <= 180),
	CONSTRAINT "agent_knowledge_nodes_content_length_check" CHECK (char_length("agent_knowledge_nodes"."content") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "agent_memory_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"source_message_id" text,
	"compressed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_nutrition_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"source" text NOT NULL,
	"calories" integer NOT NULL,
	"calories_min" integer,
	"calories_max" integer,
	"protein_grams" real NOT NULL,
	"carbs_grams" real NOT NULL,
	"fat_grams" real NOT NULL,
	"fiber_grams" real NOT NULL,
	"confidence" text NOT NULL,
	"local_date" date NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_message_id" text,
	"confirmed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_nutrition_meals_name_length_check" CHECK (char_length("agent_nutrition_meals"."name") <= 180),
	CONSTRAINT "agent_nutrition_meals_calories_check" CHECK ("agent_nutrition_meals"."calories" between 0 and 20000),
	CONSTRAINT "agent_nutrition_meals_calories_range_check" CHECK (("agent_nutrition_meals"."calories_min" is null or "agent_nutrition_meals"."calories_min" between 0 and "agent_nutrition_meals"."calories") and ("agent_nutrition_meals"."calories_max" is null or "agent_nutrition_meals"."calories_max" between "agent_nutrition_meals"."calories" and 20000)),
	CONSTRAINT "agent_nutrition_meals_macros_check" CHECK ("agent_nutrition_meals"."protein_grams" between 0 and 2000 and "agent_nutrition_meals"."carbs_grams" between 0 and 3000 and "agent_nutrition_meals"."fat_grams" between 0 and 2000 and "agent_nutrition_meals"."fiber_grams" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "agent_nutrition_profiles" (
	"identity_id" text PRIMARY KEY NOT NULL,
	"daily_calories_goal" integer NOT NULL,
	"daily_protein_goal_grams" real,
	"daily_carbs_goal_grams" real,
	"daily_fat_goal_grams" real,
	"daily_fiber_goal_grams" real,
	"source_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_nutrition_profiles_calories_goal_check" CHECK ("agent_nutrition_profiles"."daily_calories_goal" between 500 and 10000),
	CONSTRAINT "agent_nutrition_profiles_protein_goal_check" CHECK ("agent_nutrition_profiles"."daily_protein_goal_grams" is null or "agent_nutrition_profiles"."daily_protein_goal_grams" between 0 and 1000),
	CONSTRAINT "agent_nutrition_profiles_carbs_goal_check" CHECK ("agent_nutrition_profiles"."daily_carbs_goal_grams" is null or "agent_nutrition_profiles"."daily_carbs_goal_grams" between 0 and 2000),
	CONSTRAINT "agent_nutrition_profiles_fat_goal_check" CHECK ("agent_nutrition_profiles"."daily_fat_goal_grams" is null or "agent_nutrition_profiles"."daily_fat_goal_grams" between 0 and 1000),
	CONSTRAINT "agent_nutrition_profiles_fiber_goal_check" CHECK ("agent_nutrition_profiles"."daily_fiber_goal_grams" is null or "agent_nutrition_profiles"."daily_fiber_goal_grams" between 0 and 500)
);
--> statement-breakpoint
CREATE TABLE "agent_scheduled_task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"source_message_id" text,
	"output" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_scheduled_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"schedule_kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"time_zone" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"recurrence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qstash_message_id" text,
	"qstash_schedule_id" text,
	"source_message_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_scheduled_tasks_title_length_check" CHECK (char_length("agent_scheduled_tasks"."title") <= 180),
	CONSTRAINT "agent_scheduled_tasks_prompt_length_check" CHECK (char_length("agent_scheduled_tasks"."prompt") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "world_cup_2026_detected_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"game_id" text NOT NULL,
	"team_ids" text[] DEFAULT '{}' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_cup_2026_event_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_key" text NOT NULL,
	"event_key" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "world_cup_2026_game_snapshots" (
	"game_id" text PRIMARY KEY NOT NULL,
	"home_team_id" text NOT NULL,
	"away_team_id" text NOT NULL,
	"home_team_name" text NOT NULL,
	"away_team_name" text NOT NULL,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL,
	"home_scorers" text NOT NULL,
	"away_scorers" text NOT NULL,
	"finished" boolean NOT NULL,
	"time_elapsed" text NOT NULL,
	"local_date" text NOT NULL,
	"raw" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_cup_2026_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"scope" text NOT NULL,
	"team_id" text,
	"team_name" text,
	"event_types" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_knowledge_node_closure" ADD CONSTRAINT "agent_knowledge_node_closure_ancestor_id_agent_knowledge_nodes_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."agent_knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_node_closure" ADD CONSTRAINT "agent_knowledge_node_closure_descendant_id_agent_knowledge_nodes_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."agent_knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_nodes" ADD CONSTRAINT "agent_knowledge_nodes_parent_id_agent_knowledge_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."agent_knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_nodes" ADD CONSTRAINT "agent_knowledge_nodes_superseded_by_id_agent_knowledge_nodes_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."agent_knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_scheduled_task_runs" ADD CONSTRAINT "agent_scheduled_task_runs_task_id_agent_scheduled_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_scheduled_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_google_calendar_action_audit_identity_created_idx" ON "agent_google_calendar_action_audit" USING btree ("identity_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_google_calendar_action_audit_event_idx" ON "agent_google_calendar_action_audit" USING btree ("calendar_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_google_calendar_connections_active_identity_idx" ON "agent_google_calendar_connections" USING btree ("identity_id") WHERE "agent_google_calendar_connections"."status" = 'active';--> statement-breakpoint
CREATE INDEX "agent_google_calendar_connections_identity_status_idx" ON "agent_google_calendar_connections" USING btree ("identity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_google_calendar_oauth_states_request_idx" ON "agent_google_calendar_oauth_states" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_google_calendar_oauth_states_hash_idx" ON "agent_google_calendar_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "agent_google_calendar_oauth_states_identity_thread_expires_idx" ON "agent_google_calendar_oauth_states" USING btree ("identity_id","thread_id","expires_at");--> statement-breakpoint
CREATE INDEX "agent_knowledge_node_closure_ancestor_idx" ON "agent_knowledge_node_closure" USING btree ("identity_id","ancestor_id","depth");--> statement-breakpoint
CREATE INDEX "agent_knowledge_node_closure_descendant_idx" ON "agent_knowledge_node_closure" USING btree ("identity_id","descendant_id","depth");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_knowledge_nodes_active_path_idx" ON "agent_knowledge_nodes" USING btree ("identity_id","path") WHERE "agent_knowledge_nodes"."active" = true;--> statement-breakpoint
CREATE INDEX "agent_knowledge_nodes_identity_parent_idx" ON "agent_knowledge_nodes" USING btree ("identity_id","parent_id");--> statement-breakpoint
CREATE INDEX "agent_knowledge_nodes_identity_active_idx" ON "agent_knowledge_nodes" USING btree ("identity_id","active");--> statement-breakpoint
CREATE INDEX "agent_knowledge_nodes_superseded_by_idx" ON "agent_knowledge_nodes" USING btree ("superseded_by_id");--> statement-breakpoint
CREATE INDEX "agent_knowledge_nodes_embedding_idx" ON "agent_knowledge_nodes" USING hnsw ("embedding" vector_cosine_ops) WHERE "agent_knowledge_nodes"."embedding" is not null;--> statement-breakpoint
CREATE INDEX "agent_memory_chunks_identity_created_at_idx" ON "agent_memory_chunks" USING btree ("identity_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_memory_chunks_thread_created_at_idx" ON "agent_memory_chunks" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_identity_thread_created_at_idx" ON "agent_messages" USING btree ("identity_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_uncompressed_idx" ON "agent_messages" USING btree ("identity_id","thread_id","compressed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_nutrition_meals_identity_idempotency_idx" ON "agent_nutrition_meals" USING btree ("identity_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_nutrition_meals_active_draft_idx" ON "agent_nutrition_meals" USING btree ("identity_id","thread_id") WHERE "agent_nutrition_meals"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "agent_nutrition_meals_daily_idx" ON "agent_nutrition_meals" USING btree ("identity_id","local_date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_scheduled_task_runs_task_scheduled_for_idx" ON "agent_scheduled_task_runs" USING btree ("task_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "agent_scheduled_task_runs_task_idx" ON "agent_scheduled_task_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_scheduled_task_runs_status_idx" ON "agent_scheduled_task_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_scheduled_tasks_due_idx" ON "agent_scheduled_tasks" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "agent_scheduled_tasks_qstash_message_idx" ON "agent_scheduled_tasks" USING btree ("qstash_message_id");--> statement-breakpoint
CREATE INDEX "agent_scheduled_tasks_qstash_schedule_idx" ON "agent_scheduled_tasks" USING btree ("qstash_schedule_id");--> statement-breakpoint
CREATE INDEX "agent_scheduled_tasks_identity_thread_idx" ON "agent_scheduled_tasks" USING btree ("identity_id","thread_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "world_cup_2026_detected_events_event_key_idx" ON "world_cup_2026_detected_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "world_cup_2026_detected_events_game_idx" ON "world_cup_2026_detected_events" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_cup_2026_event_deliveries_delivery_key_idx" ON "world_cup_2026_event_deliveries" USING btree ("delivery_key");--> statement-breakpoint
CREATE INDEX "world_cup_2026_event_deliveries_event_idx" ON "world_cup_2026_event_deliveries" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "world_cup_2026_event_deliveries_thread_idx" ON "world_cup_2026_event_deliveries" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "world_cup_2026_subscriptions_active_idx" ON "world_cup_2026_subscriptions" USING btree ("active");--> statement-breakpoint
CREATE INDEX "world_cup_2026_subscriptions_thread_idx" ON "world_cup_2026_subscriptions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "world_cup_2026_subscriptions_team_idx" ON "world_cup_2026_subscriptions" USING btree ("team_id");

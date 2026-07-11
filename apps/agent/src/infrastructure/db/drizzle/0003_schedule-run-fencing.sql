DROP INDEX "agent_scheduled_task_runs_task_scheduled_for_idx";--> statement-breakpoint
ALTER TABLE "agent_scheduled_task_runs" ADD COLUMN "trigger_version" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE "agent_scheduled_task_runs" AS "run"
SET "trigger_version" = COALESCE(
	NULLIF("task"."metadata" ->> 'qstashTriggerVersion', ''),
	'legacy'
)
FROM "agent_scheduled_tasks" AS "task"
WHERE "run"."task_id" = "task"."id";--> statement-breakpoint
ALTER TABLE "agent_scheduled_task_runs" ADD COLUMN "claim_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_scheduled_task_runs_task_scheduled_for_idx" ON "agent_scheduled_task_runs" USING btree ("task_id","scheduled_for","trigger_version");

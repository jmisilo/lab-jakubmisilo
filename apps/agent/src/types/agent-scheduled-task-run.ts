import type { agentScheduledTaskRuns } from '@/infrastructure/db/schema';

export type AgentScheduledTaskRun = typeof agentScheduledTaskRuns.$inferSelect;
export type NewAgentScheduledTaskRun = typeof agentScheduledTaskRuns.$inferInsert;

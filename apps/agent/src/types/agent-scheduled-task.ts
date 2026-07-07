import type { agentScheduledTasks } from '@/infrastructure/db/schema';

export type AgentScheduledTask = typeof agentScheduledTasks.$inferSelect;
export type NewAgentScheduledTask = typeof agentScheduledTasks.$inferInsert;

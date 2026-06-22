import type { agentMessages } from "@/infrastructure/db/schema";

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;

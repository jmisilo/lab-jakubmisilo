import type { agentNotedMemories } from "@/infrastructure/db/schema";

export type AgentNotedMemory = typeof agentNotedMemories.$inferSelect;
export type NewAgentNotedMemory = typeof agentNotedMemories.$inferInsert;

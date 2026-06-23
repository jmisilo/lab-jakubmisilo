import type { agentMemoryChunks } from '@/infrastructure/db/schema';

export type AgentMemoryChunk = typeof agentMemoryChunks.$inferSelect;
export type NewAgentMemoryChunk = typeof agentMemoryChunks.$inferInsert;

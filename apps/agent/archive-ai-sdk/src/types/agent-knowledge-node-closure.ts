import type { agentKnowledgeNodeClosure } from '@/infrastructure/db/schema';

export type AgentKnowledgeNodeClosure = typeof agentKnowledgeNodeClosure.$inferSelect;
export type NewAgentKnowledgeNodeClosure = typeof agentKnowledgeNodeClosure.$inferInsert;

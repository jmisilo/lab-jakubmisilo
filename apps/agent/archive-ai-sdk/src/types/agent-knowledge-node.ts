import type { agentKnowledgeNodes } from '@/infrastructure/db/schema';

export type AgentKnowledgeNode = typeof agentKnowledgeNodes.$inferSelect;
export type NewAgentKnowledgeNode = typeof agentKnowledgeNodes.$inferInsert;
export type AgentKnowledgeSource = AgentKnowledgeNode['source'];

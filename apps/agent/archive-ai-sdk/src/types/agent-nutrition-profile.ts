import type { agentNutritionProfiles } from '@/infrastructure/db/schema';

export type AgentNutritionProfile = typeof agentNutritionProfiles.$inferSelect;
export type NewAgentNutritionProfile = typeof agentNutritionProfiles.$inferInsert;

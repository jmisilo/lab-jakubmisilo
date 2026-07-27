import type { agentNutritionMeals } from '@/infrastructure/db/schema';

export type AgentNutritionMeal = typeof agentNutritionMeals.$inferSelect;
export type NewAgentNutritionMeal = typeof agentNutritionMeals.$inferInsert;

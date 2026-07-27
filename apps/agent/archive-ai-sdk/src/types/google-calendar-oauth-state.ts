import type { agentGoogleCalendarOauthStates } from '@/infrastructure/db/schema';

export type GoogleCalendarOauthState = typeof agentGoogleCalendarOauthStates.$inferSelect;
export type NewGoogleCalendarOauthState = typeof agentGoogleCalendarOauthStates.$inferInsert;

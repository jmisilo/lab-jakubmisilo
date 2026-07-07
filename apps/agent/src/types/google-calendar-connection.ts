import type { agentGoogleCalendarConnections } from '@/infrastructure/db/schema';

export type GoogleCalendarConnection = typeof agentGoogleCalendarConnections.$inferSelect;
export type NewGoogleCalendarConnection = typeof agentGoogleCalendarConnections.$inferInsert;

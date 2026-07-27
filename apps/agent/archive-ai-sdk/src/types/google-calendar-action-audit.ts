import type { agentGoogleCalendarActionAudit } from '@/infrastructure/db/schema';

export type GoogleCalendarActionAudit = typeof agentGoogleCalendarActionAudit.$inferSelect;
export type NewGoogleCalendarActionAudit = typeof agentGoogleCalendarActionAudit.$inferInsert;

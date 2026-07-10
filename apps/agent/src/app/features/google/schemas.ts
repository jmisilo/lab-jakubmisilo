import { z } from 'zod';

export const GOOGLE_CONNECTION_EXPIRES_IN_MINUTES = 10;

export const GoogleServiceSchema = z.enum(['calendar', 'gmail']);

export const GOOGLE_SERVICE_SCOPES = {
  calendar: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.freebusy',
  ],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly'],
} as const satisfies Record<z.infer<typeof GoogleServiceSchema>, readonly string[]>;

export const GoogleToolContextSchema = z.object({
  identityId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  sourceMessageId: z.string().optional(),
  mode: z.enum(['chat', 'scheduled_task']).optional(),
});

export const ManageGoogleConnectionToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status').describe('Check which Google services are connected.'),
  }),
  z.object({
    action: z.literal('connect').describe('Create a short-lived Google connection link.'),
    services: z
      .array(GoogleServiceSchema)
      .min(1)
      .describe('Google services the user wants to connect or add to the existing connection.'),
  }),
  z.object({
    action: z.literal('disconnect').describe('Disconnect and revoke all Google access.'),
  }),
]);

export const GoogleConnectionToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  connected: z.boolean().optional(),
  connectedServices: z.array(GoogleServiceSchema).optional(),
  connectionUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  googleAccountEmail: z.string().optional(),
});

export const GoogleReconnectReasonSchema = z
  .enum([
    'not_connected',
    'permission_missing',
    'access_expired_or_revoked',
    'connection_link_expired',
  ])
  .describe('Safe user-facing reason for creating a fresh Google connection link.');

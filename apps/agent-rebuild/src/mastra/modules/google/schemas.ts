import { z } from 'zod';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

export const GoogleTokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export const GoogleCalendarListResponseSchema = z.looseObject({
  items: z
    .array(
      z.looseObject({
        id: z.string(),
        summary: z.string().optional(),
        accessRole: z.string().optional(),
        primary: z.boolean().optional(),
      }),
    )
    .default([]),
});

export const GoogleCalendarEventsResponseSchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string() })).default([]),
});

export const GoogleCalendarEventSchema = z.looseObject({
  id: z.string(),
  summary: z.string().optional(),
});

export const GoogleFreeBusyResponseSchema = z.looseObject({
  calendars: z.record(z.string(), z.unknown()).default({}),
});

export const GoogleGmailSearchResponseSchema = z.looseObject({
  messages: z
    .array(
      z.looseObject({
        id: z.string(),
        threadId: z.string(),
      }),
    )
    .default([]),
});

export const GoogleGmailMessageSchema = z.looseObject({
  id: z.string(),
  threadId: z.string(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: z.looseObject({
    headers: z
      .array(
        z.looseObject({
          name: z.string(),
          value: z.string(),
        }),
      )
      .default([]),
    body: z.looseObject({ data: z.string().optional() }).optional(),
    parts: z.array(z.unknown()).optional(),
  }),
});

export const GoogleConnectionInputSchema = z.object({
  action: z.enum(['connect', 'status', 'disconnect']),
});

export const ReadGmailInputSchema = z.object({
  action: z.enum(['search', 'read']),
  query: z.string().min(1).max(500).optional(),
  messageId: z.string().min(1).max(200).optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});

export const ReadGmailRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    query: z.string().min(1).max(500),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  z.object({
    action: z.literal('read'),
    messageId: z.string().min(1).max(200),
  }),
]);

export const ReadCalendarInputSchema = z.object({
  action: z.enum(['list_calendars', 'list_events', 'freebusy']),
  calendarId: z.string().min(1).max(500).optional(),
  calendarIds: z.array(z.string().min(1).max(500)).max(20).optional(),
  timeMin: z.iso.datetime({ offset: true }).optional(),
  timeMax: z.iso.datetime({ offset: true }).optional(),
  query: z.string().min(1).max(500).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});

export const ReadCalendarRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_calendars') }),
  z.object({
    action: z.literal('list_events'),
    calendarId: z.string().min(1).max(500).default('primary'),
    timeMin: z.iso.datetime({ offset: true }),
    timeMax: z.iso.datetime({ offset: true }),
    query: z.string().min(1).max(500).optional(),
    maxResults: z.number().int().min(1).max(50).default(20),
  }),
  z.object({
    action: z.literal('freebusy'),
    calendarIds: z.array(z.string().min(1).max(500)).min(1).max(20),
    timeMin: z.iso.datetime({ offset: true }),
    timeMax: z.iso.datetime({ offset: true }),
  }),
]);

const CalendarDateTimeSchema = z.object({
  dateTime: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(100).optional(),
});

export const ManageCalendarInputSchema = z.object({
  action: z.enum(['create', 'update', 'delete']),
  calendarId: z.string().min(1).max(500).optional(),
  eventId: z.string().min(1).max(500).optional(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(8_000).optional(),
  location: z.string().max(500).optional(),
  start: CalendarDateTimeSchema.optional(),
  end: CalendarDateTimeSchema.optional(),
  confirmed: z.boolean().optional(),
});

export const ManageCalendarRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    calendarId: z.string().min(1).max(500).default('primary'),
    title: z.string().min(1).max(300),
    description: z.string().max(8_000).optional(),
    location: z.string().max(500).optional(),
    start: CalendarDateTimeSchema,
    end: CalendarDateTimeSchema,
  }),
  z.object({
    action: z.literal('update'),
    calendarId: z.string().min(1).max(500).default('primary'),
    eventId: z.string().min(1).max(500),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(8_000).optional(),
    location: z.string().max(500).optional(),
    start: CalendarDateTimeSchema.optional(),
    end: CalendarDateTimeSchema.optional(),
  }),
  z.object({
    action: z.literal('delete'),
    calendarId: z.string().min(1).max(500).default('primary'),
    eventId: z.string().min(1).max(500),
    confirmed: z.literal(true),
  }),
]);

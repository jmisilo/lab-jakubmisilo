import { z } from 'zod';

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

export const GOOGLE_CALENDAR_CONNECTION_EXPIRES_IN_MINUTES = 10;
export const GOOGLE_CALENDAR_EVENT_LIST_MAX_ITEMS = 50;

const ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

const CalendarDateValueSchema = z.object({
  type: z.literal('date').describe('All-day calendar date.'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      'All-day date formatted YYYY-MM-DD. For all-day end dates, use the exclusive end date.',
    ),
});

const CalendarDateTimeValueSchema = z.object({
  type: z.literal('date_time').describe('Timed calendar date/time.'),
  dateTime: z
    .string()
    .regex(ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN)
    .describe('ISO 8601 date-time. Include a numeric offset when possible.'),
  timeZone: z
    .string()
    .min(1)
    .optional()
    .describe('IANA timezone for the date-time, usually the runtime user timezone.'),
});

export const CalendarEventTimeSchema = z.discriminatedUnion('type', [
  CalendarDateValueSchema,
  CalendarDateTimeValueSchema,
]);

export const CalendarAttendeeInputSchema = z.object({
  email: z.string().email().describe('Attendee email address.'),
  displayName: z.string().min(1).optional().describe('Optional attendee display name.'),
  optional: z.boolean().optional().describe('Whether the attendee is optional.'),
});

export const CalendarEventDraftSchema = z.object({
  title: z.string().min(1).max(500).describe('User-facing event title.'),
  start: CalendarEventTimeSchema.describe('Event start.'),
  end: CalendarEventTimeSchema.describe('Event end.'),
  description: z.string().max(8_000).optional().describe('Optional event description.'),
  location: z.string().max(1_000).optional().describe('Optional event location.'),
  attendees: z
    .array(CalendarAttendeeInputSchema)
    .max(50)
    .optional()
    .describe('Optional attendee list.'),
  createMeet: z.boolean().optional().describe('Whether to create a Google Meet link.'),
  sendUpdates: z
    .enum(['all', 'externalOnly', 'none'])
    .optional()
    .describe(
      "Guest notification behavior. Defaults to 'all' when attendees are present; otherwise omitted.",
    ),
});

export const CalendarEventUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional().describe('Updated event title.'),
  start: CalendarEventTimeSchema.optional().describe('Updated event start.'),
  end: CalendarEventTimeSchema.optional().describe('Updated event end.'),
  description: z.string().max(8_000).optional().describe('Updated event description.'),
  location: z.string().max(1_000).optional().describe('Updated event location.'),
  attendees: z
    .array(CalendarAttendeeInputSchema)
    .max(50)
    .optional()
    .describe('Updated attendee list.'),
  createMeet: z.boolean().optional().describe('Whether to add a Google Meet link.'),
  sendUpdates: z
    .enum(['all', 'externalOnly', 'none'])
    .optional()
    .describe("Guest notification behavior. Defaults to 'all' when attendees are present."),
});

export const CalendarToolContextSchema = z.object({
  identityId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  sourceMessageId: z.string().optional(),
  mode: z.enum(['chat', 'scheduled_task']).optional(),
});

export const ManageGoogleCalendarConnectionToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status').describe('Check whether Google Calendar is connected.'),
  }),
  z.object({
    action: z.literal('connect').describe('Create a short-lived Google Calendar connection link.'),
  }),
  z.object({
    action: z.literal('disconnect').describe('Disconnect and revoke Google Calendar access.'),
  }),
]);

export const ReadCalendarToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z
      .literal('list_calendars')
      .describe('List calendars visible to the connected account.'),
    includeReadOnly: z
      .boolean()
      .optional()
      .describe('Whether to include read-only calendars. Defaults to false.'),
  }),
  z.object({
    action: z.literal('list_events').describe('List calendar events in a time window or query.'),
    calendarId: z
      .string()
      .min(1)
      .optional()
      .describe("Calendar id. Use 'primary' when no named calendar is needed."),
    calendarName: z
      .string()
      .min(1)
      .optional()
      .describe('Natural calendar name to resolve when the user named a calendar.'),
    timeMin: z
      .string()
      .regex(ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN)
      .optional()
      .describe('Inclusive lower bound ISO date-time.'),
    timeMax: z
      .string()
      .regex(ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN)
      .optional()
      .describe('Exclusive upper bound ISO date-time.'),
    query: z.string().min(1).max(500).optional().describe('Text query for event search.'),
    timeZone: z.string().min(1).optional().describe('IANA timezone for event rendering.'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(GOOGLE_CALENDAR_EVENT_LIST_MAX_ITEMS)
      .optional()
      .describe(`Maximum events to return. Defaults to 10.`),
  }),
  z.object({
    action: z.literal('get_event').describe('Read one calendar event by exact event id.'),
    calendarId: z.string().min(1).describe("Calendar id, or 'primary'."),
    eventId: z.string().min(1).describe('Exact Google Calendar event id from a prior result.'),
  }),
  z.object({
    action: z.literal('freebusy').describe('Read busy windows for calendars over a time range.'),
    calendarIds: z
      .array(z.string().min(1))
      .min(1)
      .max(50)
      .optional()
      .describe('Calendar ids to query. Defaults to writable calendars when omitted.'),
    timeMin: z
      .string()
      .regex(ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN)
      .describe('Inclusive lower bound ISO date-time.'),
    timeMax: z
      .string()
      .regex(ISO_DATE_TIME_WITH_OPTIONAL_OFFSET_PATTERN)
      .describe('Exclusive upper bound ISO date-time.'),
    timeZone: z.string().min(1).optional().describe('IANA timezone for the response.'),
  }),
]);

export const ManageCalendarToolInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_event').describe('Create a Google Calendar event.'),
    calendarId: z
      .string()
      .min(1)
      .optional()
      .describe("Calendar id. Defaults to 'primary' if no calendar is named."),
    calendarName: z
      .string()
      .min(1)
      .optional()
      .describe('Natural calendar name to resolve when the user named a calendar.'),
    event: CalendarEventDraftSchema,
  }),
  z.object({
    action: z.literal('update_event').describe('Update an existing Google Calendar event.'),
    calendarId: z.string().min(1).describe("Calendar id, or 'primary'."),
    eventId: z.string().min(1).describe('Exact Google Calendar event id from a prior result.'),
    updates: CalendarEventUpdateSchema,
  }),
  z.object({
    action: z.literal('delete_event').describe('Delete an existing Google Calendar event.'),
    calendarId: z.string().min(1).describe("Calendar id, or 'primary'."),
    eventId: z.string().min(1).describe('Exact Google Calendar event id from a prior result.'),
    confirmed: z
      .boolean()
      .describe('True only when the user clearly confirmed deleting this exact event.'),
    sendUpdates: z
      .enum(['all', 'externalOnly', 'none'])
      .optional()
      .describe('Guest notification behavior for deletion.'),
  }),
]);

const CalendarToolCalendarSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  timeZone: z.string().optional(),
  primary: z.boolean(),
  accessRole: z.string(),
  writable: z.boolean(),
});

const CalendarToolEventTimeSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

const CalendarToolEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
  meetLink: z.string().optional(),
  start: CalendarToolEventTimeSchema,
  end: CalendarToolEventTimeSchema,
  attendees: z
    .array(
      z.object({
        email: z.string(),
        displayName: z.string().optional(),
        optional: z.boolean().optional(),
        responseStatus: z.string().optional(),
      }),
    )
    .optional(),
});

export const GoogleCalendarConnectionToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  connected: z.boolean().optional(),
  connectionUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  googleAccountEmail: z.string().optional(),
  grantedScopes: z.array(z.string()).optional(),
});

const CalendarReconnectReasonSchema = z
  .enum(['not_connected', 'access_expired_or_revoked', 'connection_link_expired'])
  .describe('Safe user-facing reason for creating a fresh Calendar connection link.');

export const ReadCalendarToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  connectionUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  reconnectReason: CalendarReconnectReasonSchema.optional(),
  calendars: z.array(CalendarToolCalendarSchema).optional(),
  events: z.array(CalendarToolEventSchema).optional(),
  event: CalendarToolEventSchema.optional(),
  busy: z
    .array(z.object({ calendarId: z.string(), start: z.string(), end: z.string() }))
    .optional(),
});

export const ManageCalendarToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  connectionUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  reconnectReason: CalendarReconnectReasonSchema.optional(),
  event: CalendarToolEventSchema.optional(),
});

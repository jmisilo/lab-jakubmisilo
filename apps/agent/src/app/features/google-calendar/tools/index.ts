import type { UserFacingFailure } from '@/infrastructure/errors';
import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import { GoogleCalendarConnectionService } from '@/app/features/google-calendar/connection';
import { GoogleCalendarEventService } from '@/app/features/google-calendar/events';
import {
  CalendarToolContextSchema,
  GoogleCalendarConnectionToolOutputSchema,
  ManageCalendarToolInputSchema,
  ManageCalendarToolOutputSchema,
  ManageGoogleCalendarConnectionToolInputSchema,
  ReadCalendarToolInputSchema,
  ReadCalendarToolOutputSchema,
} from '@/app/features/google-calendar/schemas';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const CALENDAR_RECONNECT_MESSAGES = {
  not_connected: 'Google Calendar is not connected yet.',
  access_expired_or_revoked: 'Google Calendar access expired or was revoked.',
  connection_link_expired: 'The previous Google Calendar connection link expired.',
} as const;

export const manageGoogleCalendarConnectionTool: ManageGoogleCalendarConnectionTool = tool({
  description: dedent`
    Connect, disconnect, or check Google Calendar access for the current user.

    # When To Use
    - The user asks to connect Google Calendar, calendar, or Google account access.
    - The user asks whether Calendar is connected.
    - The user asks to disconnect or revoke Calendar access.

    # When Not To Use
    - Reading events or availability; use read-calendar.
    - Creating, updating, or deleting events; use manage-calendar.

    # Usage
    - For connect, send the returned connectionUrl to the user and mention that it expires soon.
    - Do not say Calendar is connected until this tool or the OAuth callback confirms it.
    - For disconnect, say access was removed only after ok=true.
  `,
  inputSchema: ManageGoogleCalendarConnectionToolInputSchema,
  outputSchema: GoogleCalendarConnectionToolOutputSchema,
  contextSchema: CalendarToolContextSchema,
  execute: async (input, { context }) => {
    try {
      if (input.action === 'status') {
        const status = await GoogleCalendarConnectionService.getConnectionStatus({
          identityId: context.identityId,
        });

        return {
          ok: true,
          message: status.connected
            ? 'Google Calendar is connected.'
            : 'Google Calendar is not connected.',
          connected: status.connected,
          googleAccountEmail: status.googleAccountEmail,
          grantedScopes: status.grantedScopes,
        };
      }

      if (input.action === 'connect') {
        if (!context.threadId) {
          return {
            ok: false,
            message: 'Calendar connection links require a chat thread.',
          };
        }

        const request = await GoogleCalendarConnectionService.createConnectionRequest({
          identityId: context.identityId,
          threadId: context.threadId,
          sourceMessageId: context.sourceMessageId,
        });

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            expiresAt: request.expiresAt,
          },
          '[GOOGLE_CALENDAR]: connection link created',
        );

        return {
          ok: true,
          message: 'Google Calendar connection link created.',
          connected: false,
          connectionUrl: request.connectionUrl,
          expiresAt: request.expiresAt.toISOString(),
        };
      }

      const result = await GoogleCalendarConnectionService.disconnect({
        identityId: context.identityId,
      });

      logger.info(
        {
          identityId: context.identityId,
          disconnected: result.disconnected,
          revocationOk: result.revocationOk,
        },
        '[GOOGLE_CALENDAR]: disconnected',
      );

      return {
        ok: true,
        message: result.disconnected
          ? 'Google Calendar is disconnected.'
          : 'Google Calendar was not connected.',
        connected: false,
      };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          action: input.action,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: connection tool failed',
      );

      const failure = ErrorService.toUserFacingFailure(error, {
        fallbackCode: 'GOOGLE_CALENDAR_API_ERROR',
        fallbackMessage: 'Google Calendar connection request failed.',
      });

      return { ok: false, message: failure.message };
    }
  },
});

export const readCalendarTool: ReadCalendarTool = tool({
  description: dedent`
    Read Google Calendar calendars, events, and busy windows for the connected user.

    # When To Use
    - The user asks what is on their calendar.
    - The user asks whether they are free or busy.
    - The user asks to inspect, find, or verify a calendar event before changing it.
    - You need exact event ids before using manage-calendar for update/delete.

    # When Not To Use
    - The user asks to connect or disconnect Calendar; use manage-google-calendar-connection.
    - The user asks to create, update, or delete an event; use manage-calendar.

    # Usage
    - Use list_calendars to resolve a named calendar when needed.
    - Use list_events before update/delete when the exact event id is not visible.
    - Use freebusy for availability checks.
    - If ok=false and connectionUrl is present, send that URL to the user and mention the safe reconnect reason.
  `,
  inputSchema: ReadCalendarToolInputSchema,
  outputSchema: ReadCalendarToolOutputSchema,
  contextSchema: CalendarToolContextSchema,
  execute: async (input, { context }) => {
    try {
      if (input.action === 'list_calendars') {
        const calendars = await GoogleCalendarEventService.listCalendars({
          identityId: context.identityId,
          includeReadOnly: input.includeReadOnly,
        });

        return {
          ok: true,
          message: `Loaded ${calendars.length} calendar${calendars.length === 1 ? '' : 's'}.`,
          calendars,
        };
      }

      if (input.action === 'list_events') {
        const events = await GoogleCalendarEventService.listEvents({
          identityId: context.identityId,
          calendarId: input.calendarId,
          calendarName: input.calendarName,
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          query: input.query,
          timeZone: input.timeZone,
          maxResults: input.maxResults,
        });

        return {
          ok: true,
          message: `Loaded ${events.length} calendar event${events.length === 1 ? '' : 's'}.`,
          events: events.map((event) => toToolEvent(event)),
        };
      }

      if (input.action === 'get_event') {
        const event = await GoogleCalendarEventService.getEvent({
          identityId: context.identityId,
          calendarId: input.calendarId,
          eventId: input.eventId,
        });

        return {
          ok: true,
          message: 'Calendar event loaded.',
          event: toToolEvent(event),
        };
      }

      const busy = await GoogleCalendarEventService.queryFreeBusy({
        identityId: context.identityId,
        calendarIds: input.calendarIds,
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timeZone,
      });

      return {
        ok: true,
        message: `Loaded ${busy.length} busy window${busy.length === 1 ? '' : 's'}.`,
        busy,
      };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          action: input.action,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: read tool failed',
      );

      const failure = ErrorService.toUserFacingFailure(error, {
        fallbackCode: 'GOOGLE_CALENDAR_API_ERROR',
        fallbackMessage: 'Google Calendar read request failed.',
      });

      return createReconnectableFailureResult({
        error,
        failure,
        context,
        operation: 'read',
      });
    }
  },
});

export const manageCalendarTool: ManageCalendarTool = tool({
  description: dedent`
    Create, update, or delete Google Calendar events for the connected user.

    # When To Use
    - The user explicitly asks to add/create/schedule a calendar event.
    - The user clearly implies a calendar event by stating a concrete busy block with a title and time, even without saying "add this to Calendar".
    - The user says things like "today I have padel from 19-21", "tomorrow I have gym 6:15-9", "I'm busy with dentist 14:00-15:00", "block 9-11 for deep work", or "call it X" after an event statement.
    - The user asks for both an event and a reminder, such as "I have tennis at 19:00, remind me 30 minutes before"; use this tool for the event and manage-schedule for the reminder.
    - The user explicitly asks to update, move, rename, add attendees to, or add Meet to an existing calendar event.
    - The user explicitly asks to delete/cancel/remove a calendar event.

    # When Not To Use
    - Generic reminders or background assistant tasks; use manage-schedule.
    - Reminder-only wording such as "remind me about tennis at 19:00" or "ping me to leave for the dentist"; do not create a calendar event just because the reminder subject sounds event-like.
    - Reading calendar state only; use read-calendar.
    - Connecting or disconnecting Calendar; use manage-google-calendar-connection.
    - Free-time statements such as "other than that I am free" or "I'm free after 21:00", unless the user explicitly asks to block that free time.
    - Hypothetical or tentative plans such as "maybe padel tomorrow" unless the user confirms they want it on the calendar.

    # Safety
    - Never claim an event was created, updated, or deleted until this tool returns ok=true.
    - For update/delete, use read-calendar first unless the exact calendarId and eventId are visible in context.
    - For create, use read-calendar first when duplicate risk is high or the target window has not been checked recently. If recent context already shows the window is empty, creating directly is acceptable.
    - For delete_event, set confirmed=true only when the user clearly confirmed deleting this exact event.
    - Scheduled-task mode may create events only when allowedSideEffects includes "calendar.create". It must not update or delete events.
    - Ask a brief clarification when date/time, timezone, calendar, event identity, attendees, or Meet intent is ambiguous.
  `,
  inputSchema: ManageCalendarToolInputSchema,
  outputSchema: ManageCalendarToolOutputSchema,
  contextSchema: CalendarToolContextSchema,
  execute: async (input, { context }) => {
    try {
      if (context.mode === 'scheduled_task') {
        if (input.action !== 'create_event') {
          return {
            ok: false,
            message: 'Scheduled tasks cannot update or delete calendar events.',
          };
        }

        if (!context.allowedSideEffects?.includes('calendar.create')) {
          return {
            ok: false,
            message:
              'Scheduled tasks cannot create calendar events unless the schedule explicitly allows calendar creation.',
          };
        }
      }

      if (input.action === 'create_event') {
        const event = await GoogleCalendarEventService.createEvent({
          identityId: context.identityId,
          threadId: context.threadId,
          sourceMessageId: context.sourceMessageId,
          calendarId: input.calendarId,
          calendarName: input.calendarName,
          event: input.event,
        });

        return {
          ok: true,
          message: `Calendar event created: "${event.title}".`,
          event: toToolEvent(event),
        };
      }

      if (input.action === 'update_event') {
        const event = await GoogleCalendarEventService.updateEvent({
          identityId: context.identityId,
          threadId: context.threadId,
          sourceMessageId: context.sourceMessageId,
          calendarId: input.calendarId,
          eventId: input.eventId,
          updates: input.updates,
        });

        return {
          ok: true,
          message: `Calendar event updated: "${event.title}".`,
          event: toToolEvent(event),
        };
      }

      await GoogleCalendarEventService.deleteEvent({
        identityId: context.identityId,
        threadId: context.threadId,
        sourceMessageId: context.sourceMessageId,
        calendarId: input.calendarId,
        eventId: input.eventId,
        confirmed: input.confirmed,
        sendUpdates: input.sendUpdates,
      });

      return {
        ok: true,
        message: 'Calendar event deleted.',
      };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          threadId: context.threadId,
          action: input.action,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: manage tool failed',
      );

      const failure = ErrorService.toUserFacingFailure(error, {
        fallbackCode: 'GOOGLE_CALENDAR_API_ERROR',
        fallbackMessage: 'Google Calendar change request failed.',
      });

      return createReconnectableFailureResult({
        error,
        failure,
        context,
        operation: 'manage',
      });
    }
  },
});

function toToolEvent(event: Awaited<ReturnType<typeof GoogleCalendarEventService.getEvent>>) {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    description: event.description,
    location: event.location,
    status: event.status,
    htmlLink: event.htmlLink,
    hangoutLink: event.hangoutLink,
    meetLink: event.meetLink,
    start: event.start,
    end: event.end,
    attendees: event.attendees,
  };
}

async function createReconnectableFailureResult({
  error,
  failure,
  context,
  operation,
}: {
  error: unknown;
  failure: UserFacingFailure;
  context: z.infer<typeof CalendarToolContextSchema>;
  operation: 'read' | 'manage';
}) {
  const reconnectReason = getReconnectReason(error);

  if (!reconnectReason || !context.threadId) {
    return { ok: false as const, message: failure.message };
  }

  try {
    const request = await GoogleCalendarConnectionService.createConnectionRequest({
      identityId: context.identityId,
      threadId: context.threadId,
      sourceMessageId: context.sourceMessageId,
    });

    logger.info(
      {
        identityId: context.identityId,
        threadId: context.threadId,
        operation,
        reconnectReason,
        expiresAt: request.expiresAt,
      },
      '[GOOGLE_CALENDAR]: reconnect link created after tool failure',
    );

    return {
      ok: false as const,
      message: `${CALENDAR_RECONNECT_MESSAGES[reconnectReason]} Use this link to reconnect: ${request.connectionUrl}`,
      connectionUrl: request.connectionUrl,
      expiresAt: request.expiresAt.toISOString(),
      reconnectReason,
    };
  } catch (reconnectError) {
    logger.error(
      {
        identityId: context.identityId,
        threadId: context.threadId,
        operation,
        reconnectReason,
        error: reconnectError,
        safeError: ErrorService.toSafeLog(reconnectError),
      },
      '[GOOGLE_CALENDAR]: reconnect link creation failed after tool failure',
    );

    return { ok: false as const, message: failure.message };
  }
}

function getReconnectReason(error: unknown): keyof typeof CALENDAR_RECONNECT_MESSAGES | null {
  if (!AppError.is(error) || error.retryable) {
    return null;
  }

  if (error.code === AppErrorCode.GOOGLE_CALENDAR_CONNECTION_REQUIRED) {
    return 'not_connected';
  }

  if (error.code === AppErrorCode.GOOGLE_CALENDAR_TOKEN_INVALID) {
    return 'access_expired_or_revoked';
  }

  if (error.code === AppErrorCode.GOOGLE_CALENDAR_OAUTH_EXPIRED) {
    return 'connection_link_expired';
  }

  return null;
}

export type ManageGoogleCalendarConnectionTool = Tool<
  z.infer<typeof ManageGoogleCalendarConnectionToolInputSchema>,
  z.infer<typeof GoogleCalendarConnectionToolOutputSchema>,
  z.infer<typeof CalendarToolContextSchema>
>;

export type ReadCalendarTool = Tool<
  z.infer<typeof ReadCalendarToolInputSchema>,
  z.infer<typeof ReadCalendarToolOutputSchema>,
  z.infer<typeof CalendarToolContextSchema>
>;

export type ManageCalendarTool = Tool<
  z.infer<typeof ManageCalendarToolInputSchema>,
  z.infer<typeof ManageCalendarToolOutputSchema>,
  z.infer<typeof CalendarToolContextSchema>
>;

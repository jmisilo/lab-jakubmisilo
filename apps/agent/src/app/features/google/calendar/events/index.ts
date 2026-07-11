import type {
  CalendarEventDraftSchema,
  CalendarEventUpdateSchema,
} from '@/app/features/google/calendar/schemas';
import type {
  GoogleCalendarEventAttendee,
  GoogleCalendarEventDate,
  GoogleCalendarEventPatch,
  GoogleCalendarSendUpdates,
} from '@/app/features/google/calendar/types';
import type { AppErrorCode } from '@/infrastructure/errors';
import type { z } from 'zod';

import { randomUUID } from 'node:crypto';

import { GoogleConnectionService } from '@/app/features/google/connection';
import { GoogleCalendarDbService } from '@/infrastructure/db/services/google-calendar';
import { AppError, ErrorService } from '@/infrastructure/errors';
import { GoogleCalendarApiClient } from '@/infrastructure/google/calendar';
import { logger } from '@/infrastructure/logger';

export class GoogleCalendarEventService {
  static async listCalendars({ identityId, includeReadOnly = false }: ListCalendarsInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });
    const calendars = await GoogleCalendarApiClient.listCalendars({
      accessToken,
      minAccessRole: includeReadOnly ? 'freeBusyReader' : 'writer',
    });

    return includeReadOnly ? calendars : calendars.filter((calendar) => calendar.writable);
  }

  static async listEvents({
    identityId,
    calendarId,
    calendarName,
    timeMin,
    timeMax,
    query,
    timeZone,
    maxResults,
  }: ListEventsInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });
    const calendar = await this.#resolveCalendar({
      identityId,
      accessToken,
      calendarId,
      calendarName,
    });

    return GoogleCalendarApiClient.listEvents({
      accessToken,
      calendarId: calendar.id,
      timeMin,
      timeMax,
      query,
      timeZone,
      maxResults,
    });
  }

  static async getEvent({ identityId, calendarId, eventId }: GetEventInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });

    return GoogleCalendarApiClient.getEvent({ accessToken, calendarId, eventId });
  }

  static async queryFreeBusy({
    identityId,
    calendarIds,
    timeMin,
    timeMax,
    timeZone,
  }: QueryFreeBusyInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });
    const resolvedCalendarIds =
      calendarIds && calendarIds.length > 0
        ? calendarIds
        : await this.#getDefaultWritableCalendarIds({ identityId, accessToken });

    return GoogleCalendarApiClient.queryFreeBusy({
      accessToken,
      calendarIds: resolvedCalendarIds,
      timeMin,
      timeMax,
      timeZone,
    });
  }

  static async createEvent({
    identityId,
    threadId,
    sourceMessageId,
    calendarId,
    calendarName,
    event,
  }: CreateEventInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });
    const calendar = await this.#resolveCalendar({
      identityId,
      accessToken,
      calendarId,
      calendarName,
    });
    const googleEvent = this.#toGoogleEvent(event);

    try {
      const createdEvent = await GoogleCalendarApiClient.createEvent({
        accessToken,
        calendarId: calendar.id,
        event: googleEvent,
        sendUpdates: this.#resolveSendUpdates(event),
        conferenceDataVersion: event.createMeet ? 1 : undefined,
      });

      await this.#recordAudit({
        identityId,
        threadId,
        sourceMessageId,
        action: 'create_event',
        calendarId: calendar.id,
        eventId: createdEvent.id,
        status: 'succeeded',
      });

      return createdEvent;
    } catch (error) {
      await this.#recordFailedAudit({
        identityId,
        threadId,
        sourceMessageId,
        action: 'create_event',
        calendarId: calendar.id,
        error,
      });

      throw error;
    }
  }

  static async updateEvent({
    identityId,
    threadId,
    sourceMessageId,
    calendarId,
    eventId,
    updates,
  }: UpdateEventInput) {
    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });
    const googleEvent = this.#toGoogleEventPatch(updates);

    if (Object.keys(googleEvent).length === 0) {
      throw new AppError({
        code: 'GOOGLE_CALENDAR_MUTATION_UNSAFE',
        message: 'Google Calendar event update had no changes.',
        context: { identityId, calendarId, eventId },
        retryable: false,
        userMessage: 'Tell me what to change on that calendar event.',
      });
    }

    try {
      const updatedEvent = await GoogleCalendarApiClient.updateEvent({
        accessToken,
        calendarId,
        eventId,
        event: googleEvent,
        sendUpdates: this.#resolveSendUpdates(updates),
        conferenceDataVersion: updates.createMeet ? 1 : undefined,
      });

      await this.#recordAudit({
        identityId,
        threadId,
        sourceMessageId,
        action: 'update_event',
        calendarId,
        eventId,
        status: 'succeeded',
      });

      return updatedEvent;
    } catch (error) {
      await this.#recordFailedAudit({
        identityId,
        threadId,
        sourceMessageId,
        action: 'update_event',
        calendarId,
        eventId,
        error,
      });

      throw error;
    }
  }

  static async deleteEvent({
    identityId,
    threadId,
    sourceMessageId,
    calendarId,
    eventId,
    confirmed,
    sendUpdates,
  }: DeleteEventInput) {
    if (!confirmed) {
      throw new AppError({
        code: 'GOOGLE_CALENDAR_MUTATION_UNSAFE',
        message: 'Google Calendar event deletion requires explicit confirmation.',
        context: { identityId, calendarId, eventId },
        retryable: false,
        userMessage: 'Please confirm that you want me to delete that exact calendar event.',
      });
    }

    const accessToken = await GoogleConnectionService.getAccessToken({
      identityId,
      service: 'calendar',
    });

    try {
      await GoogleCalendarApiClient.deleteEvent({
        accessToken,
        calendarId,
        eventId,
        sendUpdates,
      });

      await this.#recordAudit({
        identityId,
        threadId,
        sourceMessageId,
        action: 'delete_event',
        calendarId,
        eventId,
        status: 'succeeded',
      });
    } catch (error) {
      await this.#recordFailedAudit({
        identityId,
        threadId,
        sourceMessageId,
        action: 'delete_event',
        calendarId,
        eventId,
        error,
      });

      throw error;
    }
  }

  static async #resolveCalendar({
    identityId,
    accessToken,
    calendarId,
    calendarName,
  }: ResolveCalendarInput) {
    if (calendarId) {
      return {
        id: calendarId,
        summary: calendarId,
      };
    }

    if (!calendarName) {
      return {
        id: 'primary',
        summary: 'Primary calendar',
      };
    }

    const normalizedCalendarName = this.#normalizeCalendarName(calendarName);
    const calendars = await GoogleCalendarApiClient.listCalendars({
      accessToken,
      minAccessRole: 'writer',
    });
    const exactMatches = calendars.filter(
      (calendar) => this.#normalizeCalendarName(calendar.summary) === normalizedCalendarName,
    );
    const fuzzyMatches =
      exactMatches.length > 0
        ? exactMatches
        : calendars.filter((calendar) =>
            this.#normalizeCalendarName(calendar.summary).includes(normalizedCalendarName),
          );
    const writableMatches = fuzzyMatches.filter((calendar) => calendar.writable);

    if (writableMatches.length === 1) {
      return writableMatches[0]!;
    }

    if (writableMatches.length > 1) {
      throw new AppError({
        code: 'GOOGLE_CALENDAR_EVENT_AMBIGUOUS',
        message: 'Multiple writable Google Calendars matched the requested name.',
        context: {
          identityId,
          calendarName,
          matchingCalendarIds: writableMatches.map((calendar) => calendar.id),
        },
        retryable: false,
        userMessage: 'I found multiple matching calendars. Which one should I use?',
      });
    }

    throw new AppError({
      code: 'GOOGLE_CALENDAR_EVENT_NOT_FOUND',
      message: 'Writable Google Calendar was not found.',
      context: { identityId, calendarName },
      retryable: false,
      userMessage: `I could not find a writable calendar named "${calendarName}".`,
    });
  }

  static async #getDefaultWritableCalendarIds({
    identityId,
    accessToken,
  }: {
    identityId: string;
    accessToken: string;
  }) {
    const calendars = await GoogleCalendarApiClient.listCalendars({
      accessToken,
      minAccessRole: 'writer',
    });
    const writableCalendarIds = calendars
      .filter((calendar) => calendar.writable)
      .map((calendar) => calendar.id);

    if (writableCalendarIds.length > 0) {
      return writableCalendarIds;
    }

    logger.warn({ identityId }, '[GOOGLE_CALENDAR]: no writable calendars found, using primary');

    return ['primary'];
  }

  static #toGoogleEvent(event: CalendarEventDraft): GoogleCalendarEventPatch {
    return {
      summary: event.title.trim(),
      description: event.description,
      location: event.location,
      start: this.#toGoogleEventDate(event.start),
      end: this.#toGoogleEventDate(event.end),
      attendees: event.attendees?.map((attendee) => this.#toGoogleAttendee(attendee)),
      conferenceData: event.createMeet
        ? {
            createRequest: {
              requestId: randomUUID(),
            },
          }
        : undefined,
    };
  }

  static #toGoogleEventPatch(event: CalendarEventUpdate): GoogleCalendarEventPatch {
    return this.#withoutUndefined({
      summary: event.title?.trim(),
      description: event.description,
      location: event.location,
      start: event.start ? this.#toGoogleEventDate(event.start) : undefined,
      end: event.end ? this.#toGoogleEventDate(event.end) : undefined,
      attendees: event.attendees?.map((attendee) => this.#toGoogleAttendee(attendee)),
      conferenceData: event.createMeet
        ? {
            createRequest: {
              requestId: randomUUID(),
            },
          }
        : undefined,
    });
  }

  static #toGoogleEventDate(eventTime: CalendarEventTime): GoogleCalendarEventDate {
    if (eventTime.type === 'date') {
      return { date: eventTime.date };
    }

    return {
      dateTime: eventTime.dateTime,
      timeZone: eventTime.timeZone,
    };
  }

  static #toGoogleAttendee(attendee: CalendarAttendee): GoogleCalendarEventAttendee {
    return {
      email: attendee.email,
      displayName: attendee.displayName,
      optional: attendee.optional,
    };
  }

  static #resolveSendUpdates(
    event: Pick<CalendarEventDraft | CalendarEventUpdate, 'attendees' | 'sendUpdates'>,
  ): GoogleCalendarSendUpdates | undefined {
    if (event.sendUpdates) {
      return event.sendUpdates;
    }

    return event.attendees && event.attendees.length > 0 ? 'all' : undefined;
  }

  static async #recordFailedAudit({
    error,
    ...input
  }: Omit<RecordAuditInput, 'status' | 'errorCode'> & { error: unknown }) {
    const errorCode = AppError.is(error) ? error.code : undefined;

    await this.#recordAudit({
      ...input,
      status: 'failed',
      errorCode,
    });
  }

  static async #recordAudit(input: RecordAuditInput) {
    try {
      await GoogleCalendarDbService.createActionAudit(input);
    } catch (error) {
      logger.warn(
        {
          identityId: input.identityId,
          action: input.action,
          calendarId: input.calendarId,
          eventId: input.eventId,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: action audit failed',
      );
    }
  }

  static #normalizeCalendarName(value: string) {
    return value.trim().toLowerCase();
  }

  static #withoutUndefined<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
      Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
    ) as {
      [K in keyof T as undefined extends T[K] ? K : K]: Exclude<T[K], undefined>;
    };
  }
}

type CalendarEventTime = z.infer<typeof CalendarEventDraftSchema>['start'];
type CalendarAttendee = NonNullable<z.infer<typeof CalendarEventDraftSchema>['attendees']>[number];
type CalendarEventDraft = z.infer<typeof CalendarEventDraftSchema>;
type CalendarEventUpdate = z.infer<typeof CalendarEventUpdateSchema>;

type ListCalendarsInput = {
  identityId: string;
  includeReadOnly?: boolean;
};

type ListEventsInput = {
  identityId: string;
  calendarId?: string;
  calendarName?: string;
  timeMin?: string;
  timeMax?: string;
  query?: string;
  timeZone?: string;
  maxResults?: number;
};

type GetEventInput = {
  identityId: string;
  calendarId: string;
  eventId: string;
};

type QueryFreeBusyInput = {
  identityId: string;
  calendarIds?: string[];
  timeMin: string;
  timeMax: string;
  timeZone?: string;
};

type CreateEventInput = {
  identityId: string;
  threadId?: string;
  sourceMessageId?: string;
  calendarId?: string;
  calendarName?: string;
  event: CalendarEventDraft;
};

type UpdateEventInput = {
  identityId: string;
  threadId?: string;
  sourceMessageId?: string;
  calendarId: string;
  eventId: string;
  updates: CalendarEventUpdate;
};

type DeleteEventInput = {
  identityId: string;
  threadId?: string;
  sourceMessageId?: string;
  calendarId: string;
  eventId: string;
  confirmed: boolean;
  sendUpdates?: GoogleCalendarSendUpdates;
};

type ResolveCalendarInput = {
  identityId: string;
  accessToken: string;
  calendarId?: string;
  calendarName?: string;
};

type RecordAuditInput = {
  identityId: string;
  threadId?: string;
  sourceMessageId?: string;
  action: string;
  calendarId?: string;
  eventId?: string;
  status: 'succeeded' | 'failed';
  errorCode?: AppErrorCode;
};

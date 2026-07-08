import type {
  GoogleCalendarBusyWindow,
  GoogleCalendarEvent,
  GoogleCalendarEventPatch,
  GoogleCalendarSendUpdates,
  GoogleCalendarSummary,
} from '@/app/features/google-calendar/types';

import { z } from 'zod';

import { UrlComposer } from '@labjm/utilities/url-composer';

import { AppError, AppErrorCode } from '@/infrastructure/errors';

const GOOGLE_CALENDAR_TIMEOUT_MS = 10_000;

const GoogleCalendarListResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional(),
        description: z.string().optional(),
        timeZone: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z
          .enum(['freeBusyReader', 'reader', 'writer', 'writerWithoutPrivateAccess', 'owner'])
          .optional(),
      }),
    )
    .optional(),
});

const GoogleCalendarEventDateSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

const GoogleCalendarEventSchema = z.object({
  id: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  start: GoogleCalendarEventDateSchema,
  end: GoogleCalendarEventDateSchema,
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
  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({
            entryPointType: z.string().optional(),
            uri: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const GoogleCalendarEventsResponseSchema = z.object({
  items: z.array(GoogleCalendarEventSchema).optional(),
});

const GoogleFreeBusyResponseSchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).optional(),
    }),
  ),
});

export class GoogleCalendarApiClient {
  static #url = new UrlComposer('www.googleapis.com', 'https');

  static async listCalendars({
    accessToken,
    minAccessRole = 'freeBusyReader',
  }: ListCalendarsInput) {
    const response = await this.#request({
      accessToken,
      path: '/users/me/calendarList',
      query: {
        maxResults: 250,
        minAccessRole,
      },
    });
    const parsed = GoogleCalendarListResponseSchema.parse(response);

    return (parsed.items ?? []).map((calendar): GoogleCalendarSummary => {
      const accessRole = calendar.accessRole ?? 'reader';

      return {
        id: calendar.id,
        summary: calendar.summary ?? calendar.id,
        description: calendar.description,
        timeZone: calendar.timeZone,
        primary: calendar.primary ?? false,
        accessRole,
        writable: ['writer', 'writerWithoutPrivateAccess', 'owner'].includes(accessRole),
      };
    });
  }

  static async listEvents({
    accessToken,
    calendarId,
    timeMin,
    timeMax,
    query,
    maxResults = 10,
    timeZone,
  }: ListEventsInput) {
    const response = await this.#request({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      query: {
        singleEvents: true,
        orderBy: timeMin ? 'startTime' : undefined,
        timeMin,
        timeMax,
        q: query,
        maxResults,
        timeZone,
      },
    });
    const parsed = GoogleCalendarEventsResponseSchema.parse(response);

    return (parsed.items ?? []).map((event) => this.#toEvent({ calendarId, event }));
  }

  static async getEvent({ accessToken, calendarId, eventId }: GetEventInput) {
    const response = await this.#request({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    });
    const event = GoogleCalendarEventSchema.parse(response);

    return this.#toEvent({ calendarId, event });
  }

  static async createEvent({
    accessToken,
    calendarId,
    event,
    sendUpdates,
    conferenceDataVersion,
  }: WriteEventInput) {
    const response = await this.#request({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      method: 'POST',
      query: {
        sendUpdates,
        conferenceDataVersion,
      },
      body: event,
    });
    const createdEvent = GoogleCalendarEventSchema.parse(response);

    return this.#toEvent({ calendarId, event: createdEvent });
  }

  static async updateEvent({
    accessToken,
    calendarId,
    eventId,
    event,
    sendUpdates,
    conferenceDataVersion,
  }: UpdateEventInput) {
    const response = await this.#request({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: 'PATCH',
      query: {
        sendUpdates,
        conferenceDataVersion,
      },
      body: event,
    });
    const updatedEvent = GoogleCalendarEventSchema.parse(response);

    return this.#toEvent({ calendarId, event: updatedEvent });
  }

  static async deleteEvent({ accessToken, calendarId, eventId, sendUpdates }: DeleteEventInput) {
    await this.#request({
      accessToken,
      path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      method: 'DELETE',
      query: {
        sendUpdates,
      },
      expectJson: false,
    });
  }

  static async queryFreeBusy({
    accessToken,
    calendarIds,
    timeMin,
    timeMax,
    timeZone,
  }: QueryFreeBusyInput) {
    const response = await this.#request({
      accessToken,
      path: '/freeBusy',
      method: 'POST',
      body: {
        timeMin,
        timeMax,
        timeZone,
        items: calendarIds.map((id) => ({ id })),
      },
    });
    const parsed = GoogleFreeBusyResponseSchema.parse(response);
    const busyWindows: GoogleCalendarBusyWindow[] = [];

    for (const [calendarId, calendar] of Object.entries(parsed.calendars)) {
      for (const busy of calendar.busy ?? []) {
        busyWindows.push({ calendarId, start: busy.start, end: busy.end });
      }
    }

    return busyWindows;
  }

  static async #request({
    accessToken,
    path,
    query,
    method = 'GET',
    body,
    expectJson = true,
  }: RequestInput) {
    const url = this.#url.compose({
      pathSegments: ['/calendar', '/v3', path],
      queryParams: this.#queryParams(query),
    });

    const response = await this.#fetchWithTimeout(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const providerMessage = await this.#readProviderErrorMessage(response);

      throw new AppError({
        code: this.#getFailureCode(response.status),
        message: 'Google Calendar API request failed.',
        context: { status: response.status, path, method, providerMessage },
        retryable: response.status >= 500,
        userMessage: this.#getFailureUserMessage(response.status),
      });
    }

    if (!expectJson || response.status === 204) {
      return null;
    }

    return response.json();
  }

  static async #fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, GOOGLE_CALENDAR_TIMEOUT_MS);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw AppError.timeout({
        code: AppErrorCode.GOOGLE_CALENDAR_API_TIMEOUT,
        message: 'Google Calendar API request timed out.',
        cause: error,
        timeoutMs: GOOGLE_CALENDAR_TIMEOUT_MS,
        retryable: true,
        userMessage: 'Google Calendar is temporarily unavailable. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  static #queryParams(query?: Record<string, string | number | boolean | undefined>) {
    return Object.fromEntries(
      Object.entries(query ?? {}).filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      ),
    );
  }

  static #getFailureCode(status: number): AppErrorCode {
    if (status === 401 || status === 403) {
      return AppErrorCode.GOOGLE_CALENDAR_TOKEN_INVALID;
    }

    if (status === 404) {
      return AppErrorCode.GOOGLE_CALENDAR_EVENT_NOT_FOUND;
    }

    return AppErrorCode.GOOGLE_CALENDAR_API_ERROR;
  }

  static #getFailureUserMessage(status: number) {
    if (status === 401 || status === 403) {
      return 'Google Calendar access expired or was revoked. Please reconnect Calendar.';
    }

    if (status === 404) {
      return 'I could not find that calendar event.';
    }

    return 'Google Calendar request failed. Please try again.';
  }

  static async #readProviderErrorMessage(response: Response) {
    const text = await response.text().catch(() => '');

    if (!text) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
      const message = parsed.error?.message ?? parsed.message;

      return typeof message === 'string' && message.trim() ? message : text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  }

  static #toEvent({
    calendarId,
    event,
  }: {
    calendarId: string;
    event: z.infer<typeof GoogleCalendarEventSchema>;
  }): GoogleCalendarEvent {
    return {
      id: event.id,
      calendarId,
      title: event.summary ?? '(untitled event)',
      description: event.description,
      location: event.location,
      status: event.status,
      htmlLink: event.htmlLink,
      hangoutLink: event.hangoutLink,
      meetLink: event.conferenceData?.entryPoints?.find(
        (entryPoint) => entryPoint.entryPointType === 'video',
      )?.uri,
      start: event.start,
      end: event.end,
      attendees: event.attendees ?? [],
      created: event.created,
      updated: event.updated,
    };
  }
}

type ListCalendarsInput = {
  accessToken: string;
  minAccessRole?: GoogleCalendarSummary['accessRole'];
};

type ListEventsInput = {
  accessToken: string;
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults?: number;
  timeZone?: string;
};

type GetEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
};

type WriteEventInput = {
  accessToken: string;
  calendarId: string;
  event: GoogleCalendarEventPatch;
  sendUpdates?: GoogleCalendarSendUpdates;
  conferenceDataVersion?: 1;
};

type UpdateEventInput = WriteEventInput & {
  eventId: string;
};

type DeleteEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  sendUpdates?: GoogleCalendarSendUpdates;
};

type QueryFreeBusyInput = {
  accessToken: string;
  calendarIds: string[];
  timeMin: string;
  timeMax: string;
  timeZone?: string;
};

type RequestInput = {
  accessToken: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  expectJson?: boolean;
};

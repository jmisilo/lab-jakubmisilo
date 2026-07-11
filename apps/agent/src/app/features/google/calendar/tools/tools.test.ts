import { AppError, AppErrorCode } from '@/infrastructure/errors';

const mockGoogleConnectionService = {
  createConnectionRequest: jest.fn(),
};
const mockGoogleCalendarEventService = {
  createEvent: jest.fn(),
  listCalendars: jest.fn(),
  updateEvent: jest.fn(),
};
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('ai', () => ({
  tool: jest.fn((definition) => definition),
}));

jest.mock('@/app/features/google/connection', () => ({
  GoogleConnectionService: mockGoogleConnectionService,
}));

jest.mock('@/app/features/google/calendar/events', () => ({
  GoogleCalendarEventService: mockGoogleCalendarEventService,
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let readCalendarTool: typeof import('.').readCalendarTool;
let manageCalendarTool: typeof import('.').manageCalendarTool;

beforeAll(async () => {
  ({ readCalendarTool, manageCalendarTool } = await import('.'));
});

describe('google calendar tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks scheduled tasks from updating calendar events', async () => {
    const execute = manageCalendarTool.execute!;
    const result = await execute(
      {
        action: 'update_event',
        calendarId: 'primary',
        eventId: 'event-1',
        updates: {
          title: 'Updated',
        },
      },
      {
        context: {
          identityId: 'identity-1',
          threadId: 'telegram:1',
          mode: 'scheduled_task',
        },
      } as Parameters<typeof execute>[1],
    );

    expect(mockGoogleCalendarEventService.updateEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: 'Scheduled tasks cannot update or delete calendar events.',
    });
  });

  it('blocks scheduled tasks from creating calendar events without explicit side-effect permission', async () => {
    const execute = manageCalendarTool.execute!;
    const result = await execute(
      {
        action: 'create_event',
        event: {
          title: 'Planning',
          start: {
            type: 'date_time',
            dateTime: '2026-07-08T10:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
          end: {
            type: 'date_time',
            dateTime: '2026-07-08T11:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
        },
      },
      {
        context: {
          identityId: 'identity-1',
          threadId: 'telegram:1',
          mode: 'scheduled_task',
        },
      } as Parameters<typeof execute>[1],
    );

    expect(mockGoogleCalendarEventService.createEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message:
        'Scheduled tasks cannot create calendar events unless the schedule explicitly allows calendar creation.',
    });
  });

  it('allows scheduled tasks to create calendar events with explicit side-effect permission', async () => {
    mockGoogleCalendarEventService.createEvent.mockResolvedValue({
      id: 'event-1',
      calendarId: 'primary',
      title: 'Planning',
      start: {
        dateTime: '2026-07-08T10:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      end: {
        dateTime: '2026-07-08T11:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      attendees: [],
    });

    const execute = manageCalendarTool.execute!;
    const result = await execute(
      {
        action: 'create_event',
        event: {
          title: 'Planning',
          start: {
            type: 'date_time',
            dateTime: '2026-07-08T10:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
          end: {
            type: 'date_time',
            dateTime: '2026-07-08T11:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
        },
      },
      {
        context: {
          identityId: 'identity-1',
          threadId: 'telegram:1',
          mode: 'scheduled_task',
          allowedSideEffects: ['calendar.create'],
        },
      } as Parameters<typeof execute>[1],
    );

    expect(mockGoogleCalendarEventService.createEvent).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: undefined,
      calendarId: undefined,
      calendarName: undefined,
      event: {
        title: 'Planning',
        start: {
          type: 'date_time',
          dateTime: '2026-07-08T10:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          type: 'date_time',
          dateTime: '2026-07-08T11:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
      },
    });
    expect(result).toEqual({
      ok: true,
      message: 'Calendar event created: "Planning".',
      event: {
        id: 'event-1',
        calendarId: 'primary',
        title: 'Planning',
        start: {
          dateTime: '2026-07-08T10:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-07-08T11:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        attendees: [],
      },
    });
  });

  it('returns a fresh connection link when reading requires Calendar connection', async () => {
    mockGoogleCalendarEventService.listCalendars.mockRejectedValue(
      new AppError({
        code: AppErrorCode.GOOGLE_CONNECTION_REQUIRED,
        message: 'Google Calendar connection is required.',
        retryable: false,
        userMessage: 'Google Calendar is not connected yet.',
      }),
    );
    mockGoogleConnectionService.createConnectionRequest.mockResolvedValue({
      connectionUrl: 'https://agent.lab.jakubmisilo.com/links/google/connect/request-2',
      expiresAt: new Date('2026-07-07T12:10:00.000Z'),
    });

    const execute = readCalendarTool.execute!;
    const result = await execute({ action: 'list_calendars' }, {
      context: {
        identityId: 'identity-1',
        threadId: 'telegram:1',
        sourceMessageId: 'message-1',
      },
    } as Parameters<typeof execute>[1]);

    expect(mockGoogleConnectionService.createConnectionRequest).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
      services: ['calendar'],
    });
    expect(result).toEqual({
      ok: false,
      message:
        'Google Calendar is not connected yet. Use this link to reconnect: https://agent.lab.jakubmisilo.com/links/google/connect/request-2',
      connectionUrl: 'https://agent.lab.jakubmisilo.com/links/google/connect/request-2',
      expiresAt: '2026-07-07T12:10:00.000Z',
      reconnectReason: 'not_connected',
    });
  });

  it('returns a fresh connection link when Calendar access expired or was revoked', async () => {
    mockGoogleCalendarEventService.createEvent.mockRejectedValue(
      new AppError({
        code: AppErrorCode.GOOGLE_TOKEN_INVALID,
        message: 'Google OAuth token request failed.',
        retryable: false,
        userMessage: 'Google Calendar access expired or was revoked. Please reconnect Calendar.',
      }),
    );
    mockGoogleConnectionService.createConnectionRequest.mockResolvedValue({
      connectionUrl: 'https://agent.lab.jakubmisilo.com/links/google/connect/request-3',
      expiresAt: new Date('2026-07-07T12:20:00.000Z'),
    });

    const execute = manageCalendarTool.execute!;
    const result = await execute(
      {
        action: 'create_event',
        event: {
          title: 'Planning',
          start: {
            type: 'date_time',
            dateTime: '2026-07-08T10:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
          end: {
            type: 'date_time',
            dateTime: '2026-07-08T11:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
        },
      },
      {
        context: {
          identityId: 'identity-1',
          threadId: 'telegram:1',
          sourceMessageId: 'message-1',
        },
      } as Parameters<typeof execute>[1],
    );

    expect(mockGoogleConnectionService.createConnectionRequest).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
      services: ['calendar'],
    });
    expect(result).toEqual({
      ok: false,
      message:
        'Google Calendar access expired or was revoked. Use this link to reconnect: https://agent.lab.jakubmisilo.com/links/google/connect/request-3',
      connectionUrl: 'https://agent.lab.jakubmisilo.com/links/google/connect/request-3',
      expiresAt: '2026-07-07T12:20:00.000Z',
      reconnectReason: 'access_expired_or_revoked',
    });
  });

  it('does not return reconnect links for Calendar server configuration failures', async () => {
    mockGoogleCalendarEventService.createEvent.mockRejectedValue(
      new AppError({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        message: 'GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.',
        retryable: false,
        userMessage: 'Google Calendar is not configured correctly.',
      }),
    );

    const execute = manageCalendarTool.execute!;
    const result = await execute(
      {
        action: 'create_event',
        event: {
          title: 'Planning',
          start: {
            type: 'date_time',
            dateTime: '2026-07-08T10:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
          end: {
            type: 'date_time',
            dateTime: '2026-07-08T11:00:00+02:00',
            timeZone: 'Europe/Warsaw',
          },
        },
      },
      {
        context: {
          identityId: 'identity-1',
          threadId: 'telegram:1',
          sourceMessageId: 'message-1',
        },
      } as Parameters<typeof execute>[1],
    );

    expect(mockGoogleConnectionService.createConnectionRequest).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      message: 'Google Calendar is not configured correctly.',
    });
  });
});

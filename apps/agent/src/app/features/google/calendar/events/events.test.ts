const mockGoogleCalendarConnectionService = {
  getAccessToken: jest.fn(),
};
const mockGoogleCalendarApiClient = {
  listCalendars: jest.fn(),
  createEvent: jest.fn(),
};
const mockGoogleCalendarDbService = {
  createActionAudit: jest.fn(),
};

jest.mock('@/app/features/google/connection', () => ({
  GoogleConnectionService: mockGoogleCalendarConnectionService,
}));

jest.mock('@/infrastructure/google/calendar', () => ({
  GoogleCalendarApiClient: mockGoogleCalendarApiClient,
}));

jest.mock('@/infrastructure/db/services/google-calendar', () => ({
  GoogleCalendarDbService: mockGoogleCalendarDbService,
}));

let GoogleCalendarEventService: typeof import('.').GoogleCalendarEventService;

beforeAll(async () => {
  ({ GoogleCalendarEventService } = await import('.'));
});

describe('GoogleCalendarEventService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGoogleCalendarConnectionService.getAccessToken.mockResolvedValue('access-token-1');
    mockGoogleCalendarDbService.createActionAudit.mockResolvedValue({});
  });

  it('creates events with attendees and Google Meet conference data', async () => {
    mockGoogleCalendarApiClient.listCalendars.mockResolvedValue([
      {
        id: 'work@example.com',
        summary: 'Work',
        primary: false,
        accessRole: 'writer',
        writable: true,
      },
    ]);
    mockGoogleCalendarApiClient.createEvent.mockResolvedValue({
      id: 'event-1',
      calendarId: 'work@example.com',
      title: 'Planning',
      start: { dateTime: '2026-07-08T10:00:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-07-08T11:00:00+02:00', timeZone: 'Europe/Warsaw' },
      attendees: [{ email: 'person@example.com' }],
      meetLink: 'https://meet.google.com/abc-defg-hij',
    });

    const result = await GoogleCalendarEventService.createEvent({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
      calendarName: 'work',
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
        attendees: [{ email: 'person@example.com' }],
        createMeet: true,
      },
    });

    expect(mockGoogleCalendarApiClient.createEvent).toHaveBeenCalledWith({
      accessToken: 'access-token-1',
      calendarId: 'work@example.com',
      sendUpdates: 'all',
      conferenceDataVersion: 1,
      event: expect.objectContaining({
        summary: 'Planning',
        start: { dateTime: '2026-07-08T10:00:00+02:00', timeZone: 'Europe/Warsaw' },
        end: { dateTime: '2026-07-08T11:00:00+02:00', timeZone: 'Europe/Warsaw' },
        attendees: [{ email: 'person@example.com', displayName: undefined, optional: undefined }],
        conferenceData: {
          createRequest: {
            requestId: expect.any(String),
          },
        },
      }),
    });
    expect(mockGoogleCalendarDbService.createActionAudit).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
      action: 'create_event',
      calendarId: 'work@example.com',
      eventId: 'event-1',
      status: 'succeeded',
    });
    expect(result).toEqual(expect.objectContaining({ id: 'event-1' }));
  });
});

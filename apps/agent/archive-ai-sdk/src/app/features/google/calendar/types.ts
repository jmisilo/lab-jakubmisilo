type GoogleCalendarAccessRole =
  | 'freeBusyReader'
  | 'reader'
  | 'writer'
  | 'writerWithoutPrivateAccess'
  | 'owner';

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary: boolean;
  accessRole: GoogleCalendarAccessRole;
  writable: boolean;
};

export type GoogleCalendarEventDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleCalendarEventAttendee = {
  email: string;
  displayName?: string;
  optional?: boolean;
  responseStatus?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  meetLink?: string;
  start: GoogleCalendarEventDate;
  end: GoogleCalendarEventDate;
  attendees: GoogleCalendarEventAttendee[];
  created?: string;
  updated?: string;
};

export type GoogleCalendarBusyWindow = {
  calendarId: string;
  start: string;
  end: string;
};

export type GoogleCalendarEventPatch = {
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventDate;
  end?: GoogleCalendarEventDate;
  attendees?: GoogleCalendarEventAttendee[];
  conferenceData?: {
    createRequest: {
      requestId: string;
    };
  };
};

export type GoogleCalendarSendUpdates = 'all' | 'externalOnly' | 'none';

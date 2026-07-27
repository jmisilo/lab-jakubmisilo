import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  GoogleConnectionInputSchema,
  ManageCalendarInputSchema,
  ManageCalendarRequestSchema,
  ReadCalendarInputSchema,
  ReadGmailInputSchema,
  ReadGmailRequestSchema,
} from './schemas';

describe('Google tool schemas', () => {
  it.each([
    GoogleConnectionInputSchema,
    ReadGmailInputSchema,
    ReadCalendarInputSchema,
    ManageCalendarInputSchema,
  ])('exposes an object-shaped model tool schema', (schema) => {
    expect(z.toJSONSchema(schema)).toMatchObject({ type: 'object' });
  });

  it('requires a Gmail query or message id for the selected action', () => {
    expect(() => ReadGmailRequestSchema.parse({ action: 'search' })).toThrow();
    expect(() => ReadGmailRequestSchema.parse({ action: 'read' })).toThrow();
  });

  it('requires explicit confirmation before deleting a calendar event', () => {
    expect(() =>
      ManageCalendarRequestSchema.parse({
        action: 'delete',
        calendarId: 'primary',
        eventId: 'event-1',
        confirmed: false,
      }),
    ).toThrow();
  });
});

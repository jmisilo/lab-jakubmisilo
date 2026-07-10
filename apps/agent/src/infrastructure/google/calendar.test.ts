import { AppError, AppErrorCode } from '@/infrastructure/errors';

import { GoogleCalendarApiClient } from './calendar';

describe('GoogleCalendarApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('classifies Calendar auth failures as reconnectable token errors', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid Credentials',
          },
        }),
        {
          status: 401,
        },
      ),
    );

    try {
      await GoogleCalendarApiClient.listCalendars({
        accessToken: 'expired-access-token',
      });

      throw new Error('Expected listCalendars to throw.');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      expect(error).toMatchObject({
        code: AppErrorCode.GOOGLE_TOKEN_INVALID,
        retryable: false,
        userMessage: 'Google access expired or was revoked. Please reconnect.',
        context: expect.objectContaining({
          status: 401,
          providerMessage: 'Invalid Credentials',
        }),
      });
    }
  });
});

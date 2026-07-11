import { AppError, AppErrorCode } from '@/infrastructure/errors';
import { GoogleGmailApiClient } from '@/infrastructure/google/gmail';

it('extracts plain-text bodies without attachment content', () => {
  const body = GoogleGmailApiClient.getTextBody({
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'text/plain',
        body: { data: Buffer.from('Hello from Gmail.').toString('base64url') },
      },
      {
        mimeType: 'application/pdf',
        filename: 'invoice.pdf',
        body: { attachmentId: 'attachment-1' },
      },
    ],
  });

  expect(body).toBe('Hello from Gmail.');
});

it('classifies Gmail network failures separately from timeouts', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

  try {
    await expect(
      GoogleGmailApiClient.searchMessages({
        accessToken: 'access-token',
        maxResults: 10,
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.GOOGLE_API_ERROR,
      message: 'Gmail API request failed before receiving a response.',
      retryable: true,
    } satisfies Partial<AppError>);
  } finally {
    global.fetch = originalFetch;
  }
});

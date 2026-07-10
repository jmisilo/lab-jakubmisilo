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

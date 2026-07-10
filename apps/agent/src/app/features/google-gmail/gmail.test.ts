const mockGoogleConnectionService = {
  getAccessToken: jest.fn(),
};
const mockGoogleGmailApiClient = {
  getHeader: jest.fn(),
  getMessage: jest.fn(),
  getTextBody: jest.fn(),
  getThread: jest.fn(),
  searchMessages: jest.fn(),
};

jest.mock('@/app/features/google/connection', () => ({
  GoogleConnectionService: mockGoogleConnectionService,
}));

jest.mock('@/infrastructure/google/gmail', () => ({
  GoogleGmailApiClient: mockGoogleGmailApiClient,
}));

let GoogleGmailService: typeof import('.').GoogleGmailService;

beforeAll(async () => {
  ({ GoogleGmailService } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGoogleConnectionService.getAccessToken.mockResolvedValue('access-token-1');
  mockGoogleGmailApiClient.getHeader.mockImplementation(
    (_payload: unknown, name: string) =>
      ({
        Subject: 'Project update',
        From: 'Anna <anna@example.com>',
        To: 'User <user@example.com>',
        Date: 'Fri, 10 Jul 2026 10:00:00 +0200',
      })[name],
  );
});

it('searches bounded Gmail metadata through the shared Google connection', async () => {
  mockGoogleGmailApiClient.searchMessages.mockResolvedValue([
    { id: 'message-1', threadId: 'thread-1' },
  ]);
  mockGoogleGmailApiClient.getMessage.mockResolvedValue({
    id: 'message-1',
    threadId: 'thread-1',
    snippet: 'The project is ready.',
    labelIds: ['INBOX'],
    payload: {},
  });

  const result = await GoogleGmailService.searchMessages({
    identityId: 'identity-1',
    query: 'newer_than:7d from:anna@example.com',
    maxResults: 50,
  });

  expect(mockGoogleConnectionService.getAccessToken).toHaveBeenCalledWith({
    identityId: 'identity-1',
    service: 'gmail',
  });
  expect(mockGoogleGmailApiClient.searchMessages).toHaveBeenCalledWith({
    accessToken: 'access-token-1',
    query: 'newer_than:7d from:anna@example.com',
    labelIds: undefined,
    maxResults: 10,
  });
  expect(result).toEqual([
    {
      id: 'message-1',
      threadId: 'thread-1',
      subject: 'Project update',
      from: 'Anna <anna@example.com>',
      to: 'User <user@example.com>',
      date: 'Fri, 10 Jul 2026 10:00:00 +0200',
      snippet: 'The project is ready.',
      labelIds: ['INBOX'],
    },
  ]);
});

it('truncates long email bodies before returning them to the agent', async () => {
  mockGoogleGmailApiClient.getMessage.mockResolvedValue({
    id: 'message-1',
    threadId: 'thread-1',
    payload: {},
  });
  mockGoogleGmailApiClient.getTextBody.mockReturnValue('x'.repeat(9_000));

  const result = await GoogleGmailService.readMessage({
    identityId: 'identity-1',
    messageId: 'message-1',
  });

  expect(result.body).toHaveLength(8_012);
  expect(result.body.endsWith('\n[truncated]')).toBe(true);
});

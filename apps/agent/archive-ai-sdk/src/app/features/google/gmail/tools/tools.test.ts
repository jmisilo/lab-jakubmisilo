import { AppError, AppErrorCode } from '@/infrastructure/errors';

const mockGoogleGmailService = {
  searchMessages: jest.fn(),
  readMessage: jest.fn(),
  readThread: jest.fn(),
};
const mockGoogleConnectionService = {
  createConnectionRequest: jest.fn(),
};

jest.mock('ai', () => ({ tool: jest.fn((definition) => definition) }));
jest.mock('@/app/features/google/gmail', () => ({
  GoogleGmailService: mockGoogleGmailService,
}));
jest.mock('@/app/features/google/connection', () => ({
  GoogleConnectionService: mockGoogleConnectionService,
}));
jest.mock('@/infrastructure/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

let readGmailTool: typeof import('.').readGmailTool;

beforeAll(async () => {
  ({ readGmailTool } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('returns a fresh Google link when Gmail permission is missing', async () => {
  mockGoogleGmailService.searchMessages.mockRejectedValue(
    new AppError({
      code: AppErrorCode.GOOGLE_PERMISSION_REQUIRED,
      message: 'Gmail permission is missing.',
      retryable: false,
      userMessage: 'Gmail read access is missing.',
    }),
  );
  mockGoogleConnectionService.createConnectionRequest.mockResolvedValue({
    connectionUrl: 'https://agent.jakubmisilo.com/links/google/connect/request-1',
    expiresAt: new Date('2026-07-10T12:10:00.000Z'),
  });

  const execute = readGmailTool.execute!;
  const result = await execute({ action: 'search_messages', query: 'newer_than:7d' }, {
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
    services: ['gmail'],
  });
  expect(result).toEqual({
    ok: false,
    message:
      'The Google connection does not include Gmail read access. Use this link to reconnect: https://agent.jakubmisilo.com/links/google/connect/request-1',
    connectionUrl: 'https://agent.jakubmisilo.com/links/google/connect/request-1',
    expiresAt: '2026-07-10T12:10:00.000Z',
    reconnectReason: 'permission_missing',
  });
});

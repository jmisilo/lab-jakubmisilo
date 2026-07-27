import { AppError, AppErrorCode } from '@/infrastructure/errors';

const mockGoogleConnectionService = {
  createConnectionRequest: jest.fn(),
  disconnect: jest.fn(),
  getConnectionStatus: jest.fn(),
};

jest.mock('ai', () => ({
  tool: jest.fn((definition) => definition),
}));

jest.mock('@/app/features/google/connection', () => ({
  GoogleConnectionService: mockGoogleConnectionService,
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

let manageGoogleConnectionTool: typeof import('.').manageGoogleConnectionTool;

beforeAll(async () => {
  ({ manageGoogleConnectionTool } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('connects Calendar and Gmail by default', async () => {
  mockGoogleConnectionService.createConnectionRequest.mockResolvedValue({
    connectionUrl: 'https://agent.jakubmisilo.com/links/google/connect/request-1',
    expiresAt: new Date('2026-07-10T12:10:00.000Z'),
  });

  const execute = manageGoogleConnectionTool.execute!;
  const result = await execute({ action: 'connect' }, {
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
    services: ['calendar', 'gmail'],
  });
  expect(result).toEqual({
    ok: true,
    message: 'Google connection link created.',
    connected: false,
    connectionUrl: 'https://agent.jakubmisilo.com/links/google/connect/request-1',
    expiresAt: '2026-07-10T12:10:00.000Z',
  });
});

it('returns a safe configuration failure', async () => {
  mockGoogleConnectionService.createConnectionRequest.mockRejectedValue(
    new AppError({
      code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
      message: 'Google token encryption key is invalid.',
      retryable: false,
      userMessage: 'Google is not configured correctly.',
    }),
  );

  const execute = manageGoogleConnectionTool.execute!;
  const result = await execute({ action: 'connect', services: ['gmail'] }, {
    context: {
      identityId: 'identity-1',
      threadId: 'telegram:1',
    },
  } as Parameters<typeof execute>[1]);

  expect(result).toEqual({ ok: false, message: 'Google is not configured correctly.' });
});

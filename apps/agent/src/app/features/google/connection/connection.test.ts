import { GOOGLE_SERVICE_SCOPES } from '@/app/features/google/schemas';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

const mockGoogleCalendarDbService = {
  createOauthState: jest.fn(),
  getActiveConnection: jest.fn(),
  markConnectionInvalid: jest.fn(),
  touchConnectionLastUsed: jest.fn(),
};
const mockGoogleOAuthService = {
  assertConfigured: jest.fn(),
  refreshAccessToken: jest.fn(),
};
const mockGoogleTokenEncryptionService = {
  assertConfigured: jest.fn(),
  decryptToken: jest.fn(),
};

jest.mock('@/infrastructure/db/services/google-calendar', () => ({
  GoogleCalendarDbService: mockGoogleCalendarDbService,
}));
jest.mock('@/infrastructure/google/oauth', () => ({
  GoogleOAuthService: mockGoogleOAuthService,
}));
jest.mock('@/infrastructure/google/token-crypto', () => ({
  GoogleTokenEncryptionService: mockGoogleTokenEncryptionService,
}));
jest.mock('@/infrastructure/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const originalAgentPublicUrl = process.env.AGENT_PUBLIC_URL;
let GoogleConnectionService: typeof import('.').GoogleConnectionService;

beforeAll(async () => {
  ({ GoogleConnectionService } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AGENT_PUBLIC_URL = 'https://agent.jakubmisilo.com';
});

afterAll(() => {
  process.env.AGENT_PUBLIC_URL = originalAgentPublicUrl;
});

it('adds Gmail scope to an existing Calendar connection request', async () => {
  mockGoogleCalendarDbService.getActiveConnection.mockResolvedValue({
    grantedScopes: [...GOOGLE_SERVICE_SCOPES.calendar],
  });
  mockGoogleCalendarDbService.createOauthState.mockImplementation(async (input) => input);

  const result = await GoogleConnectionService.createConnectionRequest({
    identityId: 'identity-1',
    threadId: 'telegram:1',
    services: ['gmail'],
  });

  expect(mockGoogleCalendarDbService.createOauthState).toHaveBeenCalledWith(
    expect.objectContaining({
      identityId: 'identity-1',
      scopes: [...GOOGLE_SERVICE_SCOPES.calendar, ...GOOGLE_SERVICE_SCOPES.gmail],
    }),
  );
  expect(result.connectionUrl).toMatch(
    /^https:\/\/agent\.jakubmisilo\.com\/links\/google\/connect\//u,
  );
});

it('rejects Gmail access when the shared connection lacks Gmail scope', async () => {
  mockGoogleCalendarDbService.getActiveConnection.mockResolvedValue({
    id: 'connection-1',
    grantedScopes: [...GOOGLE_SERVICE_SCOPES.calendar],
  });

  await expect(
    GoogleConnectionService.getAccessToken({ identityId: 'identity-1', service: 'gmail' }),
  ).rejects.toMatchObject({
    code: AppErrorCode.GOOGLE_PERMISSION_REQUIRED,
    retryable: false,
  });
  expect(mockGoogleOAuthService.refreshAccessToken).not.toHaveBeenCalled();
});

it('invalidates the connection when refresh access is revoked', async () => {
  mockGoogleCalendarDbService.getActiveConnection.mockResolvedValue({
    id: 'connection-1',
    grantedScopes: [...GOOGLE_SERVICE_SCOPES.gmail],
  });
  mockGoogleTokenEncryptionService.decryptToken.mockReturnValue('refresh-token-1');
  mockGoogleOAuthService.refreshAccessToken.mockRejectedValue(
    new AppError({
      code: AppErrorCode.GOOGLE_TOKEN_INVALID,
      message: 'Refresh token is invalid.',
      retryable: false,
    }),
  );

  await expect(
    GoogleConnectionService.getAccessToken({ identityId: 'identity-1', service: 'gmail' }),
  ).rejects.toMatchObject({ code: AppErrorCode.GOOGLE_TOKEN_INVALID });
  expect(mockGoogleCalendarDbService.markConnectionInvalid).toHaveBeenCalledWith({
    identityId: 'identity-1',
    connectionId: 'connection-1',
  });
});

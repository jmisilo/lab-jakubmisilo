import { AppError, AppErrorCode } from '@/infrastructure/errors';

import { WorldCupApiClient } from '.';

const originalFetch = global.fetch;

describe('WorldCupApiClient', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('throws stable app errors for provider status failures', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'maintenance',
    });

    await expect(WorldCupApiClient.getGames()).rejects.toMatchObject({
      code: AppErrorCode.WORLD_CUP_API_ERROR,
      message: 'World Cup API request failed.',
      context: expect.objectContaining({
        operation: 'world_cup.fetch',
        providerStatus: 503,
        providerMessage: 'maintenance',
      }),
      retryable: true,
    } satisfies Partial<AppError>);
  });
});

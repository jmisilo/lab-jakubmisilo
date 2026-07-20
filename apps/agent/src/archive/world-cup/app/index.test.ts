import { createHash, createHmac } from 'node:crypto';

import { WorldCupPollingService } from '@/archive/world-cup/app/tracking/polling';

import { WorldCupRouter } from '.';

jest.mock('@/app/bot', () => ({ bot: {} }));

jest.mock('@/archive/world-cup/app/tracking/polling', () => ({
  WorldCupPollingService: {
    pollAndDeliver: jest.fn(),
  },
}));

const pollingMock = jest.mocked(WorldCupPollingService);

describe('WorldCupRouter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
      QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('delegates a verified request to the World Cup poller', async () => {
    pollingMock.pollAndDeliver.mockResolvedValue({
      gamesChecked: 0,
      eventsDetected: 0,
      eventsCreated: 0,
      deliveriesCreated: 0,
      deliveriesSkipped: 0,
      notificationTargets: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    });
    const url = 'https://agent.example.com/jobs/world-cup/events';

    const response = await WorldCupRouter.request(url, {
      headers: {
        'upstash-signature': createQStashSignature({
          body: '',
          signingKey: 'current-signing-key',
          url,
        }),
      },
    });

    expect(response.status).toBe(200);
    expect(pollingMock.pollAndDeliver).toHaveBeenCalledWith({ bot: expect.anything() });
  });

  it('rejects an unsigned request before polling', async () => {
    const response = await WorldCupRouter.request(
      'https://agent.example.com/jobs/world-cup/events',
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' });
    expect(pollingMock.pollAndDeliver).not.toHaveBeenCalled();
  });

  it('reports missing QStash configuration before polling', async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;

    const response = await WorldCupRouter.request(
      'https://agent.example.com/jobs/world-cup/events',
      { headers: { 'upstash-signature': 'signed-token' } },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'QStash signing keys are not configured',
    });
    expect(pollingMock.pollAndDeliver).not.toHaveBeenCalled();
  });
});

function createQStashSignature({
  body,
  signingKey,
  url,
}: {
  body: string;
  signingKey: string;
  url: string;
}) {
  const now = Math.floor(Date.now() / 1_000);
  const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJwtPart({
    iss: 'Upstash',
    sub: url,
    body: createHash('sha256').update(body).digest('base64url'),
    iat: now,
    nbf: now - 1,
    exp: now + 300,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac('sha256', signingKey).update(unsignedToken).digest('base64url');

  return `${unsignedToken}.${signature}`;
}

function encodeJwtPart(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

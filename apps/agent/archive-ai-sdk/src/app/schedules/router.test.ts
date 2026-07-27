import { createHash, createHmac } from 'node:crypto';

import { AgentScheduleRunner } from '@/app/schedules/runner';

const mockWaitUntil = jest.fn();
const mockAgentObservabilityService = {
  flush: jest.fn(),
};

jest.mock('@vercel/functions', () => ({
  waitUntil: mockWaitUntil,
}));

jest.mock('@/app/bot', () => ({ bot: {} }));

jest.mock('@/infrastructure/observability', () => ({
  AgentObservabilityService: mockAgentObservabilityService,
}));

jest.mock('@/app/schedules/runner', () => ({
  AgentScheduleRunner: {
    executeTask: jest.fn(),
    handleExecutionExhausted: jest.fn(),
  },
}));

const runnerMock = jest.mocked(AgentScheduleRunner);
let ScheduleRouter: typeof import('./router').ScheduleRouter;

beforeAll(async () => {
  ({ ScheduleRouter } = await import('./router'));
});

describe('ScheduleRouter', () => {
  const originalEnv = process.env;
  let observabilityFlushPromise: Promise<void>;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
      QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
    };
    observabilityFlushPromise = Promise.resolve();
    mockAgentObservabilityService.flush.mockReturnValue(observabilityFlushPromise);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('delegates a verified execution request to the schedule runner', async () => {
    runnerMock.executeTask.mockResolvedValue({ taskId: 'task-1', status: 'sent' });
    const url = 'https://agent.example.com/jobs/schedules/execute';
    const body = JSON.stringify({
      taskId: 'task-1',
      scheduleKind: 'one_time',
      scheduledFor: '2026-07-11T09:30:00.000Z',
      triggerVersion: 'trigger-version-1',
    });

    const response = await ScheduleRouter.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': createQStashSignature({
          body,
          signingKey: 'current-signing-key',
          url,
        }),
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(runnerMock.executeTask).toHaveBeenCalledWith({
      bot: expect.anything(),
      taskId: 'task-1',
      scheduleKind: 'one_time',
      scheduledFor: new Date('2026-07-11T09:30:00.000Z'),
      triggerVersion: 'trigger-version-1',
    });
    expect(mockWaitUntil).toHaveBeenCalledWith(observabilityFlushPromise);
  });

  it('flushes pending traces when verified schedule execution fails', async () => {
    runnerMock.executeTask.mockRejectedValue(new Error('runner failed'));
    const url = 'https://agent.example.com/jobs/schedules/execute';
    const body = JSON.stringify({
      taskId: 'task-1',
      scheduleKind: 'one_time',
      scheduledFor: '2026-07-11T09:30:00.000Z',
      triggerVersion: 'trigger-version-1',
    });

    const response = await ScheduleRouter.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': createQStashSignature({
          body,
          signingKey: 'current-signing-key',
          url,
        }),
      },
      body,
    });

    expect(response.status).toBe(500);
    expect(mockWaitUntil).toHaveBeenCalledWith(observabilityFlushPromise);
  });

  it('delegates a verified failure callback to the schedule runner', async () => {
    runnerMock.handleExecutionExhausted.mockResolvedValue({
      taskId: 'task-1',
      status: 'failed',
      reason: 'retries_exhausted',
    });
    const url = 'https://agent.example.com/jobs/schedules/failure';
    const sourceBody = JSON.stringify({
      taskId: 'task-1',
      scheduleKind: 'one_time',
      scheduledFor: '2026-07-11T09:30:00.000Z',
      triggerVersion: 'trigger-version-1',
    });
    const body = JSON.stringify({
      status: 500,
      retried: 3,
      maxRetries: 3,
      dlqId: 'dlq-1',
      sourceMessageId: 'message-1',
      sourceBody: Buffer.from(sourceBody).toString('base64'),
    });

    const response = await ScheduleRouter.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': createQStashSignature({
          body,
          signingKey: 'current-signing-key',
          url,
        }),
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(runnerMock.handleExecutionExhausted).toHaveBeenCalledWith({
      taskId: 'task-1',
      scheduleKind: 'one_time',
      scheduledFor: new Date('2026-07-11T09:30:00.000Z'),
      triggerVersion: 'trigger-version-1',
      failure: {
        status: 500,
        retried: 3,
        maxRetries: 3,
        dlqId: 'dlq-1',
        sourceMessageId: 'message-1',
      },
    });
    expect(mockAgentObservabilityService.flush).not.toHaveBeenCalled();
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it('rejects an unsigned execution request before running the task', async () => {
    const response = await ScheduleRouter.request(
      'https://agent.example.com/jobs/schedules/execute',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: 'task-1' }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' });
    expect(runnerMock.executeTask).not.toHaveBeenCalled();
    expect(mockAgentObservabilityService.flush).not.toHaveBeenCalled();
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });

  it('reports missing QStash configuration before running the task', async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;

    const response = await ScheduleRouter.request(
      'https://agent.example.com/jobs/schedules/execute',
      {
        method: 'POST',
        headers: { 'upstash-signature': 'signed-token' },
        body: JSON.stringify({ taskId: 'task-1' }),
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'QStash signing keys are not configured',
    });
    expect(runnerMock.executeTask).not.toHaveBeenCalled();
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

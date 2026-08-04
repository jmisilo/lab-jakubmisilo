import { describe, expect, it, vi } from 'vitest';

import { scheduleExecutionRoute } from './routes';

const mocks = vi.hoisted(() => ({
  executeOneTime: vi.fn(),
  executeRecurring: vi.fn(),
  verifyRequest: vi.fn(),
}));

vi.mock('.', () => ({
  SchedulingService: {
    executeOneTime: mocks.executeOneTime,
    executeRecurring: mocks.executeRecurring,
    verifyRequest: mocks.verifyRequest,
  },
}));

describe('schedule execution route', () => {
  it('returns 400 for malformed signed JSON', async () => {
    mocks.verifyRequest.mockResolvedValue(true);

    if (!('handler' in scheduleExecutionRoute)) {
      throw new Error('Expected a statically registered route handler');
    }

    const context = {
      req: {
        raw: new Request('https://agent.example.com/api/jobs/schedules/execute', {
          method: 'POST',
        }),
        json: vi.fn().mockRejectedValue(new SyntaxError('invalid JSON')),
      },
      json: (body: unknown, status = 200) => Response.json(body, { status }),
    };

    const response = await scheduleExecutionRoute.handler(context as never, async () => {});

    expect(response.status).toBe(400);
    expect(mocks.executeOneTime).not.toHaveBeenCalled();
    expect(mocks.executeRecurring).not.toHaveBeenCalled();
  });

  it('returns a retryable response while another one-time delivery is still running', async () => {
    mocks.verifyRequest.mockResolvedValue(true);
    mocks.executeOneTime.mockResolvedValue({ status: 'retry_later' });

    if (!('handler' in scheduleExecutionRoute)) {
      throw new Error('Expected a statically registered route handler');
    }

    const context = {
      req: {
        raw: new Request('https://agent.example.com/api/jobs/schedules/execute', {
          method: 'POST',
        }),
        json: vi.fn().mockResolvedValue({
          kind: 'one_time',
          scheduleId: '00000000-0000-4000-8000-000000000001',
          revision: 1,
        }),
      },
      json: (body: unknown, status = 200) => Response.json(body, { status }),
    };

    const response = await scheduleExecutionRoute.handler(context as never, async () => {});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'retry_later' });
  });

  it('returns a retryable response while another recurring delivery is still running', async () => {
    mocks.verifyRequest.mockResolvedValue(true);
    mocks.executeRecurring.mockResolvedValue({ status: 'retry_later' });

    if (!('handler' in scheduleExecutionRoute)) {
      throw new Error('Expected a statically registered route handler');
    }

    const context = {
      req: {
        raw: new Request('https://agent.example.com/api/jobs/schedules/execute', {
          method: 'POST',
        }),
        json: vi.fn().mockResolvedValue({
          kind: 'recurring',
          scheduleId: 'schedule-1',
          triggerVersion: 'trigger-v1',
        }),
        header: vi.fn().mockReturnValue('delivery-1'),
      },
      get: vi.fn().mockReturnValue({}),
      json: (body: unknown, status = 200) => Response.json(body, { status }),
    };

    const response = await scheduleExecutionRoute.handler(context as never, async () => {});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'retry_later' });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SchedulingService } from '.';

const mocks = vi.hoisted(() => ({
  cancelledMessageIds: [] as string[],
  getMessage: vi.fn(),
  publishJSON: vi.fn(),
  selectResults: [] as unknown[][],
  updateResults: [] as Array<unknown[] | Error>,
}));

vi.mock('../../../infrastructure/database', () => ({
  database: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.selectResults.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            const result = mocks.updateResults.shift() ?? [];

            if (result instanceof Error) {
              throw result;
            }

            return result;
          }),
        })),
      })),
    })),
  },
}));

vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON = mocks.publishJSON;
    messages = {
      cancel: vi.fn(async (messageId: string) => {
        mocks.cancelledMessageIds.push(messageId);
      }),
      get: mocks.getMessage,
    };
    schedules = {};
  },
  Receiver: class {},
}));

describe('SchedulingService one-time compare-and-set behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T08:00:00.000Z'));
    vi.stubEnv('AGENT_PUBLIC_URL', 'https://agent.example.com');
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    mocks.cancelledMessageIds.length = 0;
    mocks.selectResults.length = 0;
    mocks.updateResults.length = 0;
    mocks.publishJSON.mockReset();
    mocks.publishJSON.mockResolvedValue({ messageId: 'new-message' });
    mocks.getMessage.mockReset();
    mocks.getMessage.mockResolvedValue({
      createdAt: new Date().getTime(),
      messageId: 'delivery-1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('uses the QStash message creation time to identify recurring retries', async () => {
    vi.setSystemTime(new Date('2026-07-28T10:05:00.000Z'));
    mocks.getMessage.mockResolvedValue({
      createdAt: new Date('2026-07-28T09:00:00.000Z').getTime(),
      messageId: 'delivery-1',
    });
    const prepareOccurrence = vi
      .spyOn(SchedulingService, 'prepareOccurrence')
      .mockResolvedValue(null);
    const mastra = {
      schedules: {
        get: vi.fn().mockResolvedValue({
          id: 'schedule-1',
          agentId: 'agent',
          resourceId: 'user-1',
          threadId: 'thread-1',
          cron: '0 * * * *',
          timezone: 'UTC',
          status: 'active',
        }),
      },
    };

    await expect(
      SchedulingService.executeRecurring({
        mastra: mastra as never,
        scheduleId: 'schedule-1',
        deliveryId: 'delivery-1',
        respectOccurrenceCompletion: true,
      }),
    ).resolves.toEqual({ status: 'occurrence_completed_early' });
    expect(mocks.getMessage).toHaveBeenCalledWith('delivery-1');
    expect(prepareOccurrence).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      cron: '0 * * * *',
      firedAt: new Date('2026-07-28T09:00:00.000Z'),
      timeZone: 'UTC',
    });
  });

  it('does not publish when resume loses its reservation compare-and-set', async () => {
    mocks.selectResults.push([
      {
        id: 'schedule-1',
        resourceId: 'user-1',
        threadId: 'thread-1',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: new Date('2026-07-28T09:00:00.000Z'),
        status: 'paused',
        qstashMessageId: null,
        revision: 2,
      },
    ]);
    mocks.updateResults.push([]);

    await expect(
      SchedulingService.resumeOneTime({
        resourceId: 'user-1',
        scheduleId: 'schedule-1',
      }),
    ).resolves.toBe(false);
    expect(mocks.publishJSON).not.toHaveBeenCalled();
    expect(mocks.cancelledMessageIds).toEqual([]);
  });

  it('cancels a newly published message when resumed activation loses a race', async () => {
    mocks.selectResults.push([
      {
        id: 'schedule-1',
        resourceId: 'user-1',
        threadId: 'thread-1',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: new Date('2026-07-28T09:00:00.000Z'),
        status: 'paused',
        qstashMessageId: null,
        revision: 2,
      },
    ]);
    mocks.updateResults.push([{ id: 'schedule-1' }], []);

    await expect(
      SchedulingService.resumeOneTime({
        resourceId: 'user-1',
        scheduleId: 'schedule-1',
      }),
    ).resolves.toBe(false);
    expect(mocks.publishJSON).toHaveBeenCalledOnce();
    expect(mocks.cancelledMessageIds).toEqual(['new-message']);
  });

  it('stops an update when its first status-and-revision compare-and-set loses', async () => {
    mocks.selectResults.push([
      {
        id: 'schedule-1',
        resourceId: 'user-1',
        threadId: 'thread-1',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: new Date('2026-07-28T09:00:00.000Z'),
        status: 'active',
        qstashMessageId: 'old-message',
        revision: 2,
      },
    ]);
    mocks.updateResults.push([]);

    await expect(
      SchedulingService.updateOneTime({
        resourceId: 'user-1',
        scheduleId: 'schedule-1',
        title: 'Call mum today',
      }),
    ).resolves.toBe(false);
    expect(mocks.publishJSON).not.toHaveBeenCalled();
    expect(mocks.cancelledMessageIds).toEqual([]);
  });

  it('cancels the replacement message when reactivation loses a cancellation race', async () => {
    mocks.selectResults.push([
      {
        id: 'schedule-1',
        resourceId: 'user-1',
        threadId: 'thread-1',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: new Date('2026-07-28T09:00:00.000Z'),
        status: 'active',
        qstashMessageId: 'old-message',
        revision: 2,
      },
    ]);
    mocks.updateResults.push([{ id: 'schedule-1' }], []);

    await expect(
      SchedulingService.updateOneTime({
        resourceId: 'user-1',
        scheduleId: 'schedule-1',
        title: 'Call mum today',
      }),
    ).resolves.toBe(false);
    expect(mocks.publishJSON).toHaveBeenCalledOnce();
    expect(mocks.cancelledMessageIds).toEqual(['old-message', 'new-message']);
  });

  it('cancels the replacement message when reactivation throws', async () => {
    const databaseError = new Error('database unavailable');
    mocks.selectResults.push([
      {
        id: 'schedule-1',
        resourceId: 'user-1',
        threadId: 'thread-1',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: new Date('2026-07-28T09:00:00.000Z'),
        status: 'active',
        qstashMessageId: 'old-message',
        revision: 2,
      },
    ]);
    mocks.updateResults.push([{ id: 'schedule-1' }], databaseError);

    await expect(
      SchedulingService.updateOneTime({
        resourceId: 'user-1',
        scheduleId: 'schedule-1',
        title: 'Call mum today',
      }),
    ).rejects.toBe(databaseError);
    expect(mocks.cancelledMessageIds).toEqual(['old-message', 'new-message']);
  });
});

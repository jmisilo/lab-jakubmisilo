import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureScheduleDelivery, SchedulingService } from '.';
import { database } from '../../infrastructure/database';

const mocks = vi.hoisted(() => ({
  cancelledMessageIds: [] as string[],
  createQstashSchedule: vi.fn(),
  deleteQstashSchedule: vi.fn(),
  getMessage: vi.fn(),
  getQstashSchedule: vi.fn(),
  insertResults: [] as unknown[][],
  pauseQstashSchedule: vi.fn(),
  postToThread: vi.fn(),
  publishJSON: vi.fn(),
  runScheduled: vi.fn(),
  selectResults: [] as unknown[][],
  updateResults: [] as Array<unknown[] | Error>,
}));

vi.mock('../../infrastructure/database', () => ({
  database: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.selectResults.shift() ?? []),
          then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(mocks.selectResults.shift() ?? []).then(resolve, reject),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => mocks.insertResults.shift() ?? []),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => mocks.insertResults.shift() ?? []),
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
    schedules = {
      create: mocks.createQstashSchedule,
      get: mocks.getQstashSchedule,
      pause: mocks.pauseQstashSchedule,
      resume: vi.fn(),
      delete: mocks.deleteQstashSchedule,
    };
  },
  Receiver: class {},
}));

describe('SchedulingService delivery boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T08:00:00.000Z'));
    vi.stubEnv('AGENT_PUBLIC_URL', 'https://agent.example.com');
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    mocks.cancelledMessageIds.length = 0;
    mocks.createQstashSchedule.mockReset();
    mocks.createQstashSchedule.mockResolvedValue({ scheduleId: 'qstash-recurring' });
    mocks.deleteQstashSchedule.mockReset();
    mocks.deleteQstashSchedule.mockResolvedValue(undefined);
    mocks.getMessage.mockReset();
    mocks.getQstashSchedule.mockReset();
    mocks.getQstashSchedule.mockResolvedValue({
      scheduleId: 'qstash-recurring',
      isPaused: false,
    });
    mocks.pauseQstashSchedule.mockReset();
    mocks.pauseQstashSchedule.mockResolvedValue(undefined);
    mocks.insertResults.length = 0;
    mocks.postToThread.mockReset();
    mocks.publishJSON.mockReset();
    mocks.publishJSON.mockResolvedValue({ messageId: 'new-message' });
    mocks.runScheduled.mockReset();
    mocks.runScheduled.mockResolvedValue('delivered');
    mocks.selectResults.length = 0;
    mocks.updateResults.length = 0;
    configureScheduleDelivery({
      postToThread: mocks.postToThread,
      runScheduled: mocks.runScheduled,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('runs a one-time reminder through Chat SDK and completes only after posting', async () => {
    const schedule = {
      id: '00000000-0000-4000-8000-000000000002',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      prompt: 'Send the SMS.',
      runAt: new Date('2026-07-28T09:00:00.000Z'),
      status: 'running',
      revision: 1,
    };
    mocks.updateResults.push([schedule], [{ id: schedule.id }]);

    await expect(
      SchedulingService.executeOneTime({
        scheduleId: schedule.id,
        revision: schedule.revision,
      }),
    ).resolves.toEqual({ status: 'completed' });

    expect(mocks.runScheduled).toHaveBeenCalledWith({
      resourceId: schedule.resourceId,
      threadId: schedule.threadId,
      prompt: schedule.prompt,
      source: 'one-time-schedule',
      deliveryId: `one-time-${schedule.id}-1`,
    });
  });

  it('leaves a one-time row retryable when Chat SDK delivery fails', async () => {
    const deliveryError = new Error('provider unavailable');
    const schedule = {
      id: 'schedule-1',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      prompt: 'Send the SMS.',
      runAt: new Date('2026-07-28T09:00:00.000Z'),
      status: 'running',
      revision: 1,
    };
    mocks.runScheduled.mockRejectedValueOnce(deliveryError);
    mocks.updateResults.push([schedule], []);

    await expect(
      SchedulingService.executeOneTime({
        scheduleId: schedule.id,
        revision: schedule.revision,
      }),
    ).rejects.toBe(deliveryError);
  });

  it('posts a user-visible failure after QStash exhausts its single retry', async () => {
    const scheduleId = '00000000-0000-4000-8000-000000000001';
    const schedule = {
      id: scheduleId,
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      title: 'Send the SMS',
      prompt: 'Send the SMS.',
      runAt: new Date('2026-07-28T09:00:00.000Z'),
      status: 'active',
      qstashMessageId: 'delivery-1',
      revision: 3,
      executionStartedAt: null,
    };
    const sourceBody = Buffer.from(
      JSON.stringify({ kind: 'one_time', scheduleId, revision: 3 }),
    ).toString('base64');
    mocks.selectResults.push([schedule]);
    mocks.updateResults.push([schedule]);

    await expect(
      SchedulingService.handleFailureCallback({
        payload: {
          status: 500,
          sourceMessageId: 'delivery-1',
          sourceBody,
        },
      }),
    ).resolves.toEqual({ status: 'failure_notified' });

    expect(mocks.postToThread).toHaveBeenCalledWith(
      schedule.threadId,
      expect.stringContaining('failed after one retry'),
    );
  });

  it('uses one QStash retry for one-time delivery', async () => {
    const schedule = {
      id: 'schedule-1',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      title: 'Call mum',
      prompt: 'Call mum.',
      runAt: new Date('2026-07-28T09:00:00.000Z'),
      status: 'active',
      qstashMessageId: null,
      revision: 1,
    };
    mocks.selectResults.push([{ value: 0 }]);
    mocks.insertResults.push([schedule]);
    mocks.updateResults.push([{ id: schedule.id }]);

    await SchedulingService.createOneTime({
      resourceId: schedule.resourceId,
      threadId: schedule.threadId,
      title: schedule.title,
      prompt: schedule.prompt,
      runAt: schedule.runAt.toISOString(),
    });

    expect(mocks.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({ retries: 1, timeout: 300 }),
    );
  });

  it('compensates a published reminder when registration loses its CAS race', async () => {
    const schedule = {
      id: 'schedule-1',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      title: 'Call mum',
      prompt: 'Call mum.',
      runAt: new Date('2026-07-28T09:00:00.000Z'),
      status: 'active',
      qstashMessageId: null,
      revision: 1,
    };
    mocks.selectResults.push([{ value: 0 }]);
    mocks.insertResults.push([schedule]);
    mocks.updateResults.push([]);

    await expect(
      SchedulingService.createOneTime({
        resourceId: schedule.resourceId,
        threadId: schedule.threadId,
        title: schedule.title,
        prompt: schedule.prompt,
        runAt: schedule.runAt.toISOString(),
      }),
    ).rejects.toThrow('changed before its delivery could be registered');

    expect(mocks.cancelledMessageIds).toEqual(['new-message']);
  });

  it('keeps a fresh one-time execution retryable instead of acknowledging it as handled', async () => {
    const schedule = {
      id: 'schedule-1',
      revision: 1,
      status: 'running',
      executionStartedAt: new Date('2026-07-28T07:59:30.000Z'),
    };
    mocks.updateResults.push([]);
    mocks.selectResults.push([schedule]);

    await expect(
      SchedulingService.executeOneTime({
        scheduleId: schedule.id,
        revision: schedule.revision,
      }),
    ).resolves.toEqual({ status: 'retry_later' });

    expect(mocks.runScheduled).not.toHaveBeenCalled();
  });

  it('leaves an active one-time reminder unchanged when replacement publishing fails', async () => {
    const schedule = {
      id: '00000000-0000-4000-8000-000000000003',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      title: 'Call mum',
      prompt: 'Call mum.',
      runAt: new Date('2026-07-28T09:00:00.000Z'),
      status: 'active',
      qstashMessageId: 'old-message',
      revision: 1,
    };
    mocks.selectResults.push([schedule]);
    mocks.publishJSON.mockRejectedValueOnce(new Error('QStash unavailable'));

    await expect(
      SchedulingService.updateOneTime({
        resourceId: schedule.resourceId,
        scheduleId: schedule.id,
        title: 'Call mother',
      }),
    ).rejects.toThrow('QStash unavailable');

    expect(database.update).not.toHaveBeenCalled();
    expect(mocks.cancelledMessageIds).toEqual([]);
  });

  it('repairs the QStash trigger before reusing an idempotent recurring schedule', async () => {
    const schedule = {
      id: 'agent-existing',
      agentId: 'agent',
      name: 'Daily check-in',
      prompt: 'Check in.',
      cron: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      threadId: 'imessage:thread-1',
      resourceId: 'user-1',
      status: 'active',
      nextFireAt: Date.now() + 60_000,
      metadata: { triggerVersion: 'trigger-v1' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;
    const schedules = {
      get: vi.fn().mockResolvedValue(schedule),
      update: vi.fn(),
    };

    await expect(
      SchedulingService.createRecurring({
        schedules: schedules as never,
        resourceId: schedule.resourceId,
        threadId: schedule.threadId,
        title: schedule.name,
        prompt: schedule.prompt,
        cron: schedule.cron,
        timeZone: schedule.timezone,
        idempotencyKey: 'same-request',
      }),
    ).resolves.toEqual(schedule);

    expect(mocks.createQstashSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'recurring',
          scheduleId: schedule.id,
          triggerVersion: 'trigger-v1',
        }),
      }),
    );
  });

  it('does not recreate a QStash trigger for an inactive idempotent recurring schedule', async () => {
    const schedule = {
      id: 'agent-existing',
      agentId: 'agent',
      resourceId: 'user-1',
      status: 'cancelled',
    } as const;
    const schedules = {
      get: vi.fn().mockResolvedValue(schedule),
    };

    await expect(
      SchedulingService.createRecurring({
        schedules: schedules as never,
        resourceId: schedule.resourceId,
        threadId: 'imessage:thread-1',
        title: 'Daily check-in',
        prompt: 'Check in.',
        cron: '0 9 * * *',
        timeZone: 'Europe/Warsaw',
        idempotencyKey: 'same-request',
      }),
    ).resolves.toEqual(schedule);

    expect(mocks.createQstashSchedule).not.toHaveBeenCalled();
  });

  it('rejects an in-flight recurring delivery from an older trigger version', async () => {
    const schedule = {
      id: 'schedule-1',
      agentId: 'agent',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      prompt: 'Current prompt.',
      cron: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      status: 'active',
      metadata: { triggerVersion: 'trigger-v2' },
    };
    const mastra = {
      schedules: { get: vi.fn().mockResolvedValue(schedule) },
    };

    await expect(
      SchedulingService.executeRecurring({
        mastra: mastra as never,
        scheduleId: schedule.id,
        triggerVersion: 'trigger-v1',
        deliveryId: 'delivery-1',
        respectOccurrenceCompletion: false,
      }),
    ).resolves.toEqual({ status: 'stale_trigger_repaired' });

    expect(mocks.runScheduled).not.toHaveBeenCalled();
    expect(mocks.createQstashSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'recurring',
          scheduleId: schedule.id,
          triggerVersion: 'trigger-v2',
        }),
      }),
    );
  });

  it('restores a recurring trigger when Mastra cancellation fails', async () => {
    const schedule = {
      id: 'schedule-1',
      agentId: 'agent',
      name: 'Daily check-in',
      prompt: 'Check in.',
      cron: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      threadId: 'imessage:thread-1',
      resourceId: 'user-1',
      status: 'active',
      metadata: { triggerVersion: 'trigger-v1' },
    };
    const persistenceError = new Error('Mastra storage unavailable');
    const schedules = {
      get: vi.fn().mockResolvedValue(schedule),
      delete: vi.fn().mockRejectedValue(persistenceError),
    };

    await expect(
      SchedulingService.changeRecurring({
        schedules: schedules as never,
        resourceId: schedule.resourceId,
        scheduleId: schedule.id,
        action: 'cancel',
      }),
    ).rejects.toBe(persistenceError);

    expect(mocks.deleteQstashSchedule).toHaveBeenCalledWith('agent-recurring-schedule-1');
    expect(mocks.createQstashSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          kind: 'recurring',
          scheduleId: schedule.id,
          triggerVersion: 'trigger-v1',
        }),
      }),
    );
  });

  it('keeps a recurring trigger paused when a paused schedule is edited', async () => {
    const schedule = {
      id: 'schedule-paused',
      agentId: 'agent',
      name: 'Daily check-in',
      prompt: 'Check in.',
      cron: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      threadId: 'imessage:thread-1',
      resourceId: 'user-1',
      status: 'paused',
      metadata: { triggerVersion: 'trigger-v1' },
    };
    const schedules = {
      get: vi.fn().mockResolvedValue(schedule),
      update: vi.fn().mockResolvedValue({
        ...schedule,
        name: 'Updated check-in',
      }),
    };

    await expect(
      SchedulingService.updateRecurring({
        schedules: schedules as never,
        resourceId: schedule.resourceId,
        scheduleId: schedule.id,
        title: 'Updated check-in',
      }),
    ).resolves.toBe(true);

    expect(mocks.pauseQstashSchedule).toHaveBeenCalledWith({
      schedule: 'agent-recurring-schedule-paused',
    });
  });

  it('does not mutate QStash when a trigger lookup fails transiently', async () => {
    const schedule = {
      id: 'schedule-1',
      agentId: 'agent',
      resourceId: 'user-1',
      cron: '0 9 * * *',
      status: 'active',
      metadata: { triggerVersion: 'trigger-v1' },
    };
    const schedules = { get: vi.fn().mockResolvedValue(schedule) };
    mocks.getQstashSchedule.mockRejectedValueOnce(
      Object.assign(new Error('QStash unavailable'), { status: 503 }),
    );

    const result = await SchedulingService.get({
      schedules: schedules as never,
      resourceId: schedule.resourceId,
      scheduleId: schedule.id,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'recurring',
        schedule: expect.objectContaining({
          trigger: { provider: 'qstash', unavailable: true },
        }),
      }),
    );
    expect(mocks.createQstashSchedule).not.toHaveBeenCalled();
  });

  it('keeps a fresh recurring execution retryable', async () => {
    const schedule = {
      id: 'schedule-1',
      agentId: 'agent',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      prompt: 'Current prompt.',
      cron: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      status: 'active',
      metadata: { triggerVersion: 'trigger-v1' },
    };
    const mastra = {
      schedules: { get: vi.fn().mockResolvedValue(schedule) },
    };
    mocks.insertResults.push([]);
    mocks.updateResults.push([]);
    mocks.selectResults.push([{ status: 'running', completedAt: null }]);

    await expect(
      SchedulingService.executeRecurring({
        mastra: mastra as never,
        scheduleId: schedule.id,
        triggerVersion: 'trigger-v1',
        deliveryId: 'delivery-1',
        respectOccurrenceCompletion: false,
      }),
    ).resolves.toEqual({ status: 'retry_later' });

    expect(mocks.runScheduled).not.toHaveBeenCalled();
  });

  it('does not reclaim a recurring delivery whose exhausted failure was finalized', async () => {
    const schedule = {
      id: 'schedule-1',
      agentId: 'agent',
      resourceId: 'user-1',
      threadId: 'imessage:thread-1',
      prompt: 'Current prompt.',
      cron: '0 9 * * *',
      timezone: 'Europe/Warsaw',
      status: 'active',
      metadata: { triggerVersion: 'trigger-v1' },
    };
    const mastra = {
      schedules: { get: vi.fn().mockResolvedValue(schedule) },
    };
    mocks.insertResults.push([]);
    mocks.updateResults.push([]);
    mocks.selectResults.push([
      { status: 'failed', completedAt: new Date('2026-07-28T08:00:00.000Z') },
    ]);

    await expect(
      SchedulingService.executeRecurring({
        mastra: mastra as never,
        scheduleId: schedule.id,
        triggerVersion: 'trigger-v1',
        deliveryId: 'delivery-1',
        respectOccurrenceCompletion: false,
      }),
    ).resolves.toEqual({ status: 'already_handled' });

    expect(mocks.runScheduled).not.toHaveBeenCalled();
  });

  it('does not report run-now success for a paused recurring schedule', async () => {
    const schedule = {
      id: 'schedule-1',
      agentId: 'agent',
      resourceId: 'user-1',
      status: 'paused',
    };
    const mastra = {
      schedules: { get: vi.fn().mockResolvedValue(schedule) },
    };

    await expect(
      SchedulingService.runRecurringNow({
        mastra: mastra as never,
        resourceId: schedule.resourceId,
        scheduleId: schedule.id,
      }),
    ).resolves.toBe(false);

    expect(mocks.runScheduled).not.toHaveBeenCalled();
  });

  it('does not query the UUID one-time table for a recurring schedule id', async () => {
    const schedule = {
      id: 'agent_recurring-schedule',
      agentId: 'agent',
      resourceId: 'user-1',
      status: 'active',
    };
    const schedules = {
      get: vi.fn().mockResolvedValue(schedule),
    };

    await expect(
      SchedulingService.get({
        schedules: schedules as never,
        resourceId: schedule.resourceId,
        scheduleId: schedule.id,
      }),
    ).resolves.toEqual(expect.objectContaining({ kind: 'recurring' }));

    expect(database.select).not.toHaveBeenCalled();
    expect(schedules.get).toHaveBeenCalledWith(schedule.id);
  });

  it('skips one-time mutations for a recurring schedule id', async () => {
    await expect(
      SchedulingService.pauseOneTime({
        resourceId: 'user-1',
        scheduleId: 'agent_recurring-schedule',
      }),
    ).resolves.toBe(false);

    expect(database.update).not.toHaveBeenCalled();
  });
});

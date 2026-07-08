const mockPublishJSON = jest.fn();
const mockScheduleCreate = jest.fn();
const mockMessageCancel = jest.fn();
const mockScheduleDelete = jest.fn();

jest.mock('@upstash/qstash', () => ({
  Client: jest.fn(() => ({
    publishJSON: mockPublishJSON,
    schedules: {
      create: mockScheduleCreate,
      delete: mockScheduleDelete,
    },
    messages: {
      cancel: mockMessageCancel,
    },
  })),
}));

describe('QStashService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      QSTASH_TOKEN: 'qstash-token',
      AGENT_PUBLIC_URL: 'https://agent.example.com',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses a QStash-safe deduplication id for one-time tasks', async () => {
    mockPublishJSON.mockResolvedValue({ messageId: 'msg-1' });
    const { QStashService } = await import('.');

    const taskId = '54fc072f-f5eb-4c04-a31f-df1f767fb5f1';
    const runAt = new Date('2026-07-06T17:00:00.000Z');
    const messageId = await QStashService.scheduleOneTimeTask({
      taskId,
      runAt,
      triggerVersion: 'trigger-version-1',
      previewSlug: 'tennis-reminder',
    });

    expect(messageId).toBe('msg-1');
    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://agent.example.com/jobs/schedules/execute',
        body: {
          taskId,
          scheduleKind: 'one_time',
          scheduledFor: '2026-07-06T17:00:00.000Z',
          triggerVersion: 'trigger-version-1',
          previewSlug: 'tennis-reminder',
        },
        notBefore: 1783357200,
        failureCallback: 'https://agent.example.com/jobs/schedules/failure',
        deduplicationId: `agent-schedule-${taskId}-1783357200000-trigger-version-1`,
        label: [
          'agent-schedule',
          'agent-schedule-one-time',
          'agent-schedule-one-time-tennis-reminder',
          `task-${taskId}`,
        ],
      }),
    );
    expect(mockPublishJSON.mock.calls[0][0].deduplicationId).not.toContain(':');
  });

  it('treats deduplicated one-time schedule publishes as provider failures', async () => {
    mockPublishJSON.mockResolvedValue({ messageId: 'msg-1', deduplicated: true });
    const { QStashService } = await import('.');

    await expect(
      QStashService.scheduleOneTimeTask({
        taskId: 'task-1',
        runAt: new Date('2026-07-06T17:00:00.000Z'),
        triggerVersion: 'trigger-version-1',
        previewSlug: 'reminder',
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_PROVIDER_ERROR',
      message: 'QStash one-time schedule was deduplicated and not enqueued.',
    });
  });

  it('falls back to VERCEL_URL when AGENT_PUBLIC_URL is missing', async () => {
    mockPublishJSON.mockResolvedValue({ messageId: 'msg-1' });
    delete process.env.AGENT_PUBLIC_URL;
    process.env.VERCEL_URL = 'preview.example.vercel.app';

    const { QStashService } = await import('.');

    await QStashService.scheduleOneTimeTask({
      taskId: 'task-1',
      runAt: new Date('2026-07-06T17:00:00.000Z'),
      triggerVersion: 'trigger-version-1',
      previewSlug: 'preview-task',
    });

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://preview.example.vercel.app/jobs/schedules/execute',
        failureCallback: 'https://preview.example.vercel.app/jobs/schedules/failure',
      }),
    );
  });

  it('marks recurring schedule payloads as recurring', async () => {
    mockScheduleCreate.mockResolvedValue({ scheduleId: 'agent-task-task-1' });
    const { QStashService } = await import('.');

    await QStashService.scheduleRecurringTask({
      taskId: 'task-1',
      recurrence: {
        frequency: 'weekdays',
        daysOfWeek: ['monday', 'tuesday'],
        timeOfDay: '09:00',
      },
      timeZone: 'Europe/Warsaw',
      triggerVersion: 'trigger-version-1',
      previewSlug: 'todo-prep',
    });

    expect(mockScheduleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({
          taskId: 'task-1',
          scheduleKind: 'recurring',
          triggerVersion: 'trigger-version-1',
          previewSlug: 'todo-prep',
        }),
        label: 'agent-schedule-recurring-todo-prep',
      }),
    );
  });

  it('fails when no public deployment URL can be resolved', async () => {
    delete process.env.AGENT_PUBLIC_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;

    const { QStashService } = await import('.');

    await expect(
      QStashService.scheduleOneTimeTask({
        taskId: 'task-1',
        runAt: new Date('2026-07-06T17:00:00.000Z'),
        triggerVersion: 'trigger-version-1',
        previewSlug: 'preview-task',
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_PROVIDER_UNAVAILABLE',
      message: 'Agent public URL could not be resolved for QStash schedules.',
    });
  });
});

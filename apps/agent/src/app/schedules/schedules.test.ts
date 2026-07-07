import type { AgentScheduleService as AgentScheduleServiceType } from '.';

const mockAgentScheduleDbService = {
  createTask: jest.fn(),
  listTasks: jest.fn(),
  cancelTask: jest.fn(),
  countActiveTasksByKind: jest.fn(),
};
const mockQStashService = {
  scheduleOneTimeTask: jest.fn(),
  scheduleRecurringTask: jest.fn(),
  cancelScheduledTask: jest.fn(),
};

jest.mock('@/infrastructure/db/services/agent-schedule', () => ({
  AgentScheduleDbService: mockAgentScheduleDbService,
}));

jest.mock('@/infrastructure/qstash', () => ({
  QStashService: mockQStashService,
}));

let AgentScheduleService: typeof AgentScheduleServiceType;

beforeAll(async () => {
  ({ AgentScheduleService } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentScheduleDbService.countActiveTasksByKind.mockResolvedValue(0);
  mockQStashService.scheduleOneTimeTask.mockResolvedValue('msg-task-1');
  mockQStashService.scheduleRecurringTask.mockResolvedValue('agent-task-task-1');
  mockQStashService.cancelScheduledTask.mockResolvedValue(undefined);
  jest.useFakeTimers({
    now: new Date('2026-07-06T06:00:00.000Z'),
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AgentScheduleService', () => {
  it('creates a one-time scheduled task with normalized content', async () => {
    mockAgentScheduleDbService.createTask.mockImplementation((input) => input);

    const task = await AgentScheduleService.createTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      title: ' Tennis reminder ',
      prompt: ' Send the user a short reminder about their tennis game. ',
      schedule: {
        type: 'one_time',
        runAt: '2026-07-06T17:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      sourceMessageId: 'message-1',
      userFacingSchedule: 'today at 19:00 Europe/Warsaw',
    });

    expect(task).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        identityId: 'identity-1',
        threadId: 'telegram:1',
        title: 'Tennis reminder',
        prompt: 'Send the user a short reminder about their tennis game.',
        scheduleKind: 'one_time',
        timeZone: 'Europe/Warsaw',
        recurrence: {},
        qstashMessageId: 'msg-task-1',
        qstashScheduleId: null,
        sourceMessageId: 'message-1',
        metadata: {
          userFacingSchedule: 'today at 19:00 Europe/Warsaw',
          qstashFailureCallback: true,
        },
      }),
    );
    expect(task?.nextRunAt.toISOString()).toBe('2026-07-06T15:00:00.000Z');
    expect(mockQStashService.scheduleOneTimeTask).toHaveBeenCalledWith({
      taskId: task?.id,
      runAt: new Date('2026-07-06T15:00:00.000Z'),
    });
  });

  it('resolves the next weekday recurrence in the task timezone', async () => {
    mockAgentScheduleDbService.createTask.mockImplementation((input) => input);

    const task = await AgentScheduleService.createTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      title: 'Todo prep',
      prompt: 'Ask the user to prepare their todo list.',
      schedule: {
        type: 'recurring',
        timeZone: 'Europe/Warsaw',
        recurrence: {
          frequency: 'weekdays',
          timeOfDay: '09:00',
        },
      },
    });

    expect(task?.scheduleKind).toBe('recurring');
    expect(task?.nextRunAt.toISOString()).toBe('2026-07-06T07:00:00.000Z');
    expect(task?.recurrence).toEqual({
      frequency: 'weekdays',
      daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      timeOfDay: '09:00',
    });
    expect(mockQStashService.scheduleRecurringTask).toHaveBeenCalledWith({
      taskId: task?.id,
      recurrence: {
        frequency: 'weekdays',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        timeOfDay: '09:00',
      },
      timeZone: 'Europe/Warsaw',
    });
  });

  it('rejects one-time schedules more than seven days ahead on the QStash free plan', async () => {
    await expect(
      AgentScheduleService.createTask({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        title: 'Far reminder',
        prompt: 'Remind the user later.',
        schedule: {
          type: 'one_time',
          runAt: '2026-07-14T08:00:01.000Z',
          timeZone: 'Europe/Warsaw',
        },
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_INVALID',
      userMessage:
        'One-time schedules can be created up to 7 days ahead on the current QStash free plan.',
    });

    expect(mockQStashService.scheduleOneTimeTask).not.toHaveBeenCalled();
  });

  it('rejects one-time schedules after the active per-user limit', async () => {
    mockAgentScheduleDbService.countActiveTasksByKind.mockResolvedValue(
      AgentScheduleService.activeOneTimeTaskLimit,
    );

    await expect(
      AgentScheduleService.createTask({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        title: 'Limit reminder',
        prompt: 'Remind the user.',
        schedule: {
          type: 'one_time',
          runAt: '2026-07-06T17:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_LIMIT_EXCEEDED',
      userMessage:
        'You already have 10 active one-time schedules. Cancel one before creating another.',
    });

    expect(mockQStashService.scheduleOneTimeTask).not.toHaveBeenCalled();
  });

  it('interprets offset-less one-time schedules in the provided timezone', async () => {
    mockAgentScheduleDbService.createTask.mockImplementation((input) => input);

    const task = await AgentScheduleService.createTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      title: 'Offsetless reminder',
      prompt: 'Remind the user.',
      schedule: {
        type: 'one_time',
        runAt: '2026-07-06T17:00:00',
        timeZone: 'Europe/Warsaw',
      },
    });

    expect(task?.nextRunAt.toISOString()).toBe('2026-07-06T15:00:00.000Z');
    expect(mockQStashService.scheduleOneTimeTask).toHaveBeenCalledWith({
      taskId: task?.id,
      runAt: new Date('2026-07-06T15:00:00.000Z'),
    });
  });

  it('uses the next matching day when today recurring time already passed', () => {
    const nextRunAt = AgentScheduleService.getNextRunAtForTask({
      task: createTask({
        nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
        recurrence: {
          frequency: 'weekly',
          daysOfWeek: ['monday', 'friday'],
          timeOfDay: '09:00',
        },
      }),
      now: new Date('2026-07-06T08:00:00.000Z'),
    });

    expect(nextRunAt?.toISOString()).toBe('2026-07-10T07:00:00.000Z');
  });

  it('lists active tasks with a bounded limit', async () => {
    mockAgentScheduleDbService.listTasks.mockResolvedValue([]);

    await AgentScheduleService.listTasks({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      limit: 500,
    });

    expect(mockAgentScheduleDbService.listTasks).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      includeInactive: undefined,
      limit: AgentScheduleService.taskListLimit,
    });
  });

  it('cancels the external QStash trigger after marking a task cancelled', async () => {
    mockAgentScheduleDbService.cancelTask.mockResolvedValue(
      createTask({
        nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
        recurrence: {},
        qstashMessageId: 'msg-task-1',
      }),
    );

    await AgentScheduleService.cancelTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
      reason: 'Not needed.',
    });

    expect(mockQStashService.cancelScheduledTask).toHaveBeenCalledWith({
      qstashMessageId: 'msg-task-1',
      qstashScheduleId: null,
    });
  });
});

function createTask({
  nextRunAt,
  recurrence,
  qstashMessageId = null,
  qstashScheduleId = null,
}: {
  nextRunAt: Date;
  recurrence: Record<string, unknown>;
  qstashMessageId?: string | null;
  qstashScheduleId?: string | null;
}) {
  return {
    id: 'task-1',
    identityId: 'identity-1',
    threadId: 'telegram:1',
    title: 'Shopping',
    prompt: 'Remind the user about shopping.',
    scheduleKind: 'recurring',
    status: 'active',
    timeZone: 'Europe/Warsaw',
    nextRunAt,
    recurrence,
    qstashMessageId,
    qstashScheduleId,
    sourceMessageId: null,
    metadata: {},
    lastRunAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as const;
}

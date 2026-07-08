import type { AgentScheduleService as AgentScheduleServiceType } from '.';

const mockAgentScheduleDbService = {
  createTask: jest.fn(),
  getTaskForUser: jest.fn(),
  updateTask: jest.fn(),
  pauseTask: jest.fn(),
  resumeTask: jest.fn(),
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
          qstashTriggerVersion: expect.any(String),
        },
      }),
    );
    expect(task?.nextRunAt.toISOString()).toBe('2026-07-06T15:00:00.000Z');
    expect(mockQStashService.scheduleOneTimeTask).toHaveBeenCalledWith({
      taskId: task?.id,
      runAt: new Date('2026-07-06T15:00:00.000Z'),
      triggerVersion: expect.any(String),
      previewSlug: 'tennis-reminder',
    });
  });

  it('stores explicit side-effect permissions on scheduled tasks', async () => {
    mockAgentScheduleDbService.createTask.mockImplementation((input) => input);

    const task = await AgentScheduleService.createTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      title: 'Calendar blocker',
      prompt: 'Create a calendar planning block when this task runs.',
      schedule: {
        type: 'one_time',
        runAt: '2026-07-06T17:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      allowedSideEffects: ['calendar.create', 'calendar.create'],
    });

    expect(task?.metadata).toEqual(
      expect.objectContaining({
        allowedSideEffects: ['calendar.create'],
      }),
    );
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
      triggerVersion: expect.any(String),
      previewSlug: 'todo-prep',
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
      triggerVersion: expect.any(String),
      previewSlug: 'offsetless-reminder',
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

  it('updates an active one-time schedule and cancels the previous external trigger', async () => {
    const existingTask = createTask({
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
      recurrence: {},
      qstashMessageId: 'msg-old',
    });
    const updatedTask = {
      ...existingTask,
      title: 'Updated shopping',
      nextRunAt: new Date('2026-07-06T15:00:00.000Z'),
      qstashMessageId: 'msg-new',
    };

    mockAgentScheduleDbService.getTaskForUser.mockResolvedValue(existingTask);
    mockAgentScheduleDbService.updateTask.mockResolvedValue(updatedTask);
    mockQStashService.scheduleOneTimeTask.mockResolvedValue('msg-new');

    const task = await AgentScheduleService.updateTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
      title: 'Updated shopping',
      schedule: {
        type: 'one_time',
        runAt: '2026-07-06T17:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      userFacingSchedule: 'today at 17:00 Europe/Warsaw',
    });

    expect(task).toBe(updatedTask);
    expect(mockQStashService.scheduleOneTimeTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      runAt: new Date('2026-07-06T15:00:00.000Z'),
      triggerVersion: expect.any(String),
      previewSlug: 'updated-shopping',
    });
    expect(mockAgentScheduleDbService.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        taskId: 'task-1',
        title: 'Updated shopping',
        scheduleKind: 'one_time',
        nextRunAt: new Date('2026-07-06T15:00:00.000Z'),
        qstashMessageId: 'msg-new',
        qstashScheduleId: null,
        metadata: {
          userFacingSchedule: 'today at 17:00 Europe/Warsaw',
          qstashTriggerVersion: expect.any(String),
        },
      }),
    );
    expect(mockQStashService.cancelScheduledTask).toHaveBeenCalledWith({
      qstashMessageId: 'msg-old',
      qstashScheduleId: null,
    });
  });

  it('updates scheduled task side-effect permissions without rescheduling', async () => {
    const existingTask = createTask({
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
      recurrence: {},
      qstashMessageId: 'msg-existing',
    });
    const updatedTask = {
      ...existingTask,
      metadata: {
        allowedSideEffects: ['calendar.create'],
      },
    };

    mockAgentScheduleDbService.getTaskForUser.mockResolvedValue(existingTask);
    mockAgentScheduleDbService.updateTask.mockResolvedValue(updatedTask);

    const task = await AgentScheduleService.updateTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
      allowedSideEffects: ['calendar.create', 'calendar.create'],
    });

    expect(task).toBe(updatedTask);
    expect(mockQStashService.scheduleOneTimeTask).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        taskId: 'task-1',
        metadata: {
          allowedSideEffects: ['calendar.create'],
        },
      }),
    );
  });

  it('pauses an active task and cancels the external trigger', async () => {
    mockAgentScheduleDbService.pauseTask.mockResolvedValue(
      createTask({
        scheduleKind: 'one_time',
        status: 'paused',
        nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
        recurrence: {},
        qstashMessageId: 'msg-task-1',
      }),
    );

    const task = await AgentScheduleService.pauseTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
      reason: 'User asked to pause it.',
    });

    expect(task.status).toBe('paused');
    expect(mockAgentScheduleDbService.pauseTask).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
      metadata: expect.objectContaining({
        pauseReason: 'User asked to pause it.',
      }),
    });
    expect(mockQStashService.cancelScheduledTask).toHaveBeenCalledWith({
      qstashMessageId: 'msg-task-1',
      qstashScheduleId: null,
    });
  });

  it('resumes a paused recurring task with a fresh next run and QStash schedule', async () => {
    const pausedTask = createTask({
      status: 'paused',
      nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
      recurrence: {
        frequency: 'weekdays',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        timeOfDay: '09:00',
      },
      qstashScheduleId: 'agent-task-task-1',
    });
    const resumedTask = {
      ...pausedTask,
      status: 'active' as const,
      nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
    };

    mockAgentScheduleDbService.getTaskForUser.mockResolvedValue(pausedTask);
    mockAgentScheduleDbService.resumeTask.mockResolvedValue(resumedTask);
    mockQStashService.scheduleRecurringTask.mockResolvedValue('agent-task-task-1');

    const task = await AgentScheduleService.resumeTask({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
    });

    expect(task).toBe(resumedTask);
    expect(mockQStashService.scheduleRecurringTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      recurrence: {
        frequency: 'weekdays',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        timeOfDay: '09:00',
      },
      timeZone: 'Europe/Warsaw',
      triggerVersion: expect.any(String),
      previewSlug: 'shopping',
    });
    expect(mockAgentScheduleDbService.resumeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        taskId: 'task-1',
        nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
        qstashMessageId: null,
        qstashScheduleId: 'agent-task-task-1',
        metadata: expect.objectContaining({
          qstashTriggerVersion: expect.any(String),
        }),
      }),
    );
  });
});

function createTask({
  nextRunAt,
  recurrence,
  scheduleKind = 'recurring',
  status = 'active',
  qstashMessageId = null,
  qstashScheduleId = null,
}: {
  nextRunAt: Date;
  recurrence: Record<string, unknown>;
  scheduleKind?: 'one_time' | 'recurring';
  status?: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';
  qstashMessageId?: string | null;
  qstashScheduleId?: string | null;
}) {
  return {
    id: 'task-1',
    identityId: 'identity-1',
    threadId: 'telegram:1',
    title: 'Shopping',
    prompt: 'Remind the user about shopping.',
    scheduleKind,
    status,
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

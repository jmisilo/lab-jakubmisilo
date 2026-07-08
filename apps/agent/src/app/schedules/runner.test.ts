import type { AgentScheduleRunner as AgentScheduleRunnerType } from '@/app/schedules/runner';

const mockAgentScheduleDbService = {
  getTaskById: jest.fn(),
  createTaskRun: jest.fn(),
  getTaskRunByScheduledFor: jest.fn(),
  markTaskRunSent: jest.fn(),
  markTaskRunFailed: jest.fn(),
  completeTask: jest.fn(),
  failTask: jest.fn(),
  rescheduleTask: jest.fn(),
};
const mockAgentService = {
  generate: jest.fn(),
};
const mockAgentMemoryService = {
  buildContext: jest.fn(),
  recordMessage: jest.fn(),
};
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('@/infrastructure/db/services/agent-schedule', () => ({
  AgentScheduleDbService: mockAgentScheduleDbService,
}));

jest.mock('@/app/agent', () => ({
  AgentService: mockAgentService,
}));

jest.mock('@/app/memory', () => ({
  AgentMemoryService: mockAgentMemoryService,
}));

jest.mock('@/app/memory/context', () => ({
  AgentContextService: {
    contextSourceMessageLimit: 200,
  },
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let AgentScheduleRunner: typeof AgentScheduleRunnerType;

beforeAll(async () => {
  ({ AgentScheduleRunner } = await import('@/app/schedules/runner'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentMemoryService.buildContext.mockResolvedValue([]);
});

describe('AgentScheduleRunner', () => {
  it('claims, executes, posts, records, and completes a triggered one-time task', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: {
        qstashFailureCallback: true,
      },
    });
    const thread = createThread();
    const bot = createBot({
      thread,
      shortTermMemory: [
        {
          role: 'user',
          text: 'I prefer short reminders.',
        },
      ],
    });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockResolvedValue({
      text: 'Tennis starts at 7pm.',
    });
    mockAgentMemoryService.buildContext.mockResolvedValue([
      {
        role: 'user',
        content: 'Durable knowledge: the user prefers short reminders.',
      },
    ]);

    const result = await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentScheduleDbService.createTaskRun).toHaveBeenCalledWith({
      taskId: 'task-1',
      scheduledFor: new Date('2026-07-06T17:00:00.000Z'),
    });
    expect(bot.initialize).toHaveBeenCalledTimes(1);
    expect(bot.initialize.mock.invocationCallOrder[0]!).toBeLessThan(
      mockAgentScheduleDbService.createTaskRun.mock.invocationCallOrder[0]!,
    );
    expect(mockAgentMemoryService.buildContext).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      shortTermMemory: [
        {
          role: 'user',
          text: 'I prefer short reminders.',
        },
        {
          role: 'user',
          text: task.prompt,
        },
      ],
    });
    expect(mockAgentService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'telegram:1',
        timeZone: 'Europe/Warsaw',
        mode: 'scheduled_task',
        scheduledTaskSideEffects: [],
      }),
    );
    const generateInput = mockAgentService.generate.mock.calls[0][0];

    expect(generateInput.messages).toEqual(
      expect.arrayContaining([
        {
          role: 'user',
          content: 'Durable knowledge: the user prefers short reminders.',
        },
      ]),
    );
    expect(generateInput.messages.at(-1)?.content).toContain('# Context Available');
    expect(generateInput.messages.at(-1)?.content).toContain('# Tool Use');
    expect(generateInput.messages.at(-1)?.content).toContain(
      'Scheduled task allowed side effects: none.',
    );
    expect(thread.post).toHaveBeenCalledWith({ markdown: 'Tennis starts at 7pm.' });
    expect(bot.transcripts.append).toHaveBeenCalledWith(
      thread,
      { role: 'assistant', text: 'Tennis starts at 7pm.' },
      { userKey: 'identity-1' },
    );
    expect(mockAgentMemoryService.recordMessage).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      role: 'assistant',
      content: 'Tennis starts at 7pm.',
    });
    expect(mockAgentScheduleDbService.markTaskRunSent).toHaveBeenCalledWith({
      runId: 'run-1',
      output: 'Tennis starts at 7pm.',
    });
    expect(mockAgentScheduleDbService.completeTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
    });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'sent',
    });
  });

  it('passes explicit scheduled task side effects into scheduled agent execution', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: {
        qstashFailureCallback: true,
        allowedSideEffects: ['calendar.create'],
      },
    });
    const thread = createThread();
    const bot = createBot({ thread });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockResolvedValue({
      text: 'Calendar event created.',
    });

    await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'scheduled_task',
        scheduledTaskSideEffects: ['calendar.create'],
      }),
    );
    expect(mockAgentService.generate.mock.calls[0][0].messages.at(-1)?.content).toContain(
      'Scheduled task allowed side effects: calendar.create.',
    );
  });

  it('recovers task advancement when another delivery already posted the scheduled run', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: {
        qstashFailureCallback: true,
      },
    });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue(null);
    mockAgentScheduleDbService.getTaskRunByScheduledFor.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
      status: 'sent',
      scheduledFor: new Date('2026-07-06T17:00:00.000Z'),
    });

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot() as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.completeTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
    });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'sent',
      reason: 'already_sent_recovered',
    });
  });

  it('retries instead of swallowing a task when another delivery is still running', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: {
        qstashFailureCallback: true,
      },
    });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue(null);
    mockAgentScheduleDbService.getTaskRunByScheduledFor.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
      status: 'running',
      scheduledFor: new Date('2026-07-06T17:00:00.000Z'),
    });

    await expect(
      AgentScheduleRunner.executeTask({
        bot: createBot() as never,
        taskId: 'task-1',
        now: new Date('2026-07-06T17:00:30.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_EXECUTION_FAILED',
      retryable: true,
      context: expect.objectContaining({
        runStatus: 'running',
      }),
    });

    expect(mockAgentService.generate).not.toHaveBeenCalled();
  });

  it('skips when the task is inactive', async () => {
    mockAgentScheduleDbService.getTaskById.mockResolvedValue(
      createTask({
        id: 'task-1',
        scheduleKind: 'one_time',
        status: 'completed',
        nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      }),
    );

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot() as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'skipped',
      reason: 'task_not_active',
    });
  });

  it('skips stale deliveries from an old schedule kind after a task is changed', async () => {
    mockAgentScheduleDbService.getTaskById.mockResolvedValue(
      createTask({
        id: 'task-1',
        scheduleKind: 'one_time',
        nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      }),
    );

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot() as never,
      taskId: 'task-1',
      scheduleKind: 'recurring',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'skipped',
      reason: 'stale_payload',
    });
  });

  it('skips stale deliveries from an old QStash trigger version', async () => {
    mockAgentScheduleDbService.getTaskById.mockResolvedValue(
      createTask({
        id: 'task-1',
        scheduleKind: 'recurring',
        nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
        metadata: {
          qstashTriggerVersion: 'current-trigger-version',
        },
      }),
    );

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot() as never,
      taskId: 'task-1',
      scheduleKind: 'recurring',
      triggerVersion: 'stale-trigger-version',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'skipped',
      reason: 'stale_payload',
    });
  });

  it('fails retryably when QStash delivers before the task exists in DB', async () => {
    mockAgentScheduleDbService.getTaskById.mockResolvedValue(null);

    await expect(
      AgentScheduleRunner.executeTask({
        bot: createBot() as never,
        taskId: 'task-1',
        now: new Date('2026-07-06T17:00:30.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_NOT_FOUND',
      retryable: true,
    });
    expect(mockAgentService.generate).not.toHaveBeenCalled();
  });

  it('executes when QStash delivers slightly before the stored due time', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const thread = createThread();
    const bot = createBot({ thread });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockResolvedValue({
      text: 'Check your email.',
    });

    const result = await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T16:59:45.000Z'),
    });

    expect(thread.post).toHaveBeenCalledWith({ markdown: 'Check your email.' });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'sent',
    });
  });

  it('retries without marking the run failed when post-send bookkeeping fails after delivery', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: {
        qstashFailureCallback: true,
      },
    });
    const thread = createThread();
    const bot = createBot({ thread });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    const error = new Error('db update failed');

    mockAgentScheduleDbService.completeTask.mockRejectedValue(error);
    mockAgentService.generate.mockResolvedValue({
      text: 'Time to walk the dog.',
    });

    await expect(
      AgentScheduleRunner.executeTask({
        bot: bot as never,
        taskId: 'task-1',
        now: new Date('2026-07-06T17:00:30.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_EXECUTION_FAILED',
      retryable: true,
      context: expect.objectContaining({
        delivered: true,
      }),
    });

    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(thread.post).toHaveBeenCalledWith({ markdown: 'Time to walk the dog.' });
    expect(mockAgentScheduleDbService.markTaskRunSent).toHaveBeenCalledWith({
      runId: 'run-1',
      output: 'Time to walk the dog.',
    });
    expect(mockAgentScheduleDbService.markTaskRunFailed).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.failTask).not.toHaveBeenCalled();
  });

  it('marks the run failed and retries through QStash when generation fails before posting', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: {
        qstashFailureCallback: true,
      },
    });
    const thread = createThread();
    const bot = createBot({ thread });
    const error = new Error('model unavailable');

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockRejectedValue(error);

    await expect(
      AgentScheduleRunner.executeTask({
        bot: bot as never,
        taskId: 'task-1',
        now: new Date('2026-07-06T17:00:30.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_EXECUTION_FAILED',
      retryable: true,
    });

    expect(mockAgentScheduleDbService.markTaskRunFailed).toHaveBeenCalledWith({
      runId: 'run-1',
      error,
    });
    expect(thread.post).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.failTask).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.rescheduleTask).not.toHaveBeenCalled();
  });

  it('silently advances legacy tasks without a QStash failure callback after generation failure', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const thread = createThread();
    const bot = createBot({ thread });
    const error = new Error('model unavailable');

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockRejectedValue(error);

    const result = await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(thread.post).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.failTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
    });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'failed',
      reason: 'legacy_failure_callback_unavailable',
    });
  });

  it('advances a recurring task after QStash exhausts execution retries', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'recurring',
      nextRunAt: new Date('2026-07-06T07:00:00.000Z'),
      recurrence: {
        frequency: 'weekdays',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        timeOfDay: '09:00',
      },
    });

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);

    const result = await AgentScheduleRunner.handleExecutionExhausted({
      taskId: 'task-1',
      now: new Date('2026-07-06T07:03:00.000Z'),
      failure: {
        status: 500,
        retried: 3,
        maxRetries: 3,
        dlqId: 'dlq-1',
      },
    });

    expect(mockAgentScheduleDbService.rescheduleTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      ranAt: new Date('2026-07-06T07:03:00.000Z'),
      nextRunAt: new Date('2026-07-07T07:00:00.000Z'),
    });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'failed',
      reason: 'retries_exhausted',
    });
  });
});

function createTask({
  id,
  scheduleKind,
  status = 'active',
  nextRunAt,
  recurrence = {},
  metadata = {
    userFacingSchedule: 'today at 19:00 Europe/Warsaw',
  },
}: {
  id: string;
  scheduleKind: 'one_time' | 'recurring';
  status?: 'active' | 'completed' | 'cancelled' | 'failed';
  nextRunAt: Date;
  recurrence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  return {
    id,
    identityId: 'identity-1',
    threadId: 'telegram:1',
    title: 'Tennis reminder',
    prompt: 'Send the user a short reminder about their tennis game.',
    scheduleKind,
    status,
    timeZone: 'Europe/Warsaw',
    nextRunAt,
    recurrence,
    sourceMessageId: 'message-1',
    metadata,
    lastRunAt: null,
    completedAt: null,
    cancelledAt: null,
    failedAt: null,
    createdAt: new Date('2026-07-06T10:00:00.000Z'),
    updatedAt: new Date('2026-07-06T10:00:00.000Z'),
  };
}

function createThread() {
  return {
    id: 'telegram:1',
    post: jest.fn(),
  };
}

function createBot({
  thread = createThread(),
  shortTermMemory = [],
}: {
  thread?: ReturnType<typeof createThread>;
  shortTermMemory?: Array<{ role: 'user' | 'assistant'; text: string }>;
} = {}) {
  return {
    initialize: jest.fn(),
    thread: jest.fn(() => thread),
    transcripts: {
      list: jest.fn().mockResolvedValue(shortTermMemory),
      append: jest.fn(),
    },
  };
}

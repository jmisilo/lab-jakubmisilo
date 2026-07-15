import type { AgentScheduleRunner as AgentScheduleRunnerType } from '@/app/schedules/runner';

const mockAgentScheduleDbService = {
  getTaskById: jest.fn(),
  createTaskRun: jest.fn(),
  getTaskRunByScheduledFor: jest.fn(),
  renewTaskRunLease: jest.fn(),
  markTaskRunSkipped: jest.fn(),
  markTaskRunFailed: jest.fn(),
  finishSuccessfulTaskRun: jest.fn(),
  advanceTaskAfterRun: jest.fn(),
};
const mockAgentService = {
  generate: jest.fn(),
};
const mockAgentMemoryService = {
  buildContext: jest.fn(),
  getRecentMessages: jest.fn(),
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
  jest.resetAllMocks();
  mockAgentMemoryService.buildContext.mockResolvedValue([]);
  mockAgentScheduleDbService.renewTaskRunLease.mockResolvedValue(true);
  mockAgentScheduleDbService.finishSuccessfulTaskRun.mockResolvedValue({ taskUpdated: true });
  mockAgentScheduleDbService.advanceTaskAfterRun.mockResolvedValue({ taskUpdated: true });
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
      triggerVersion: 'legacy',
      claimToken: expect.any(String),
    });
    const claimToken = mockAgentScheduleDbService.createTaskRun.mock.calls[0][0].claimToken;

    expect(claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mockAgentScheduleDbService.renewTaskRunLease).toHaveBeenCalledWith({
      runId: 'run-1',
      taskId: task.id,
      claimToken,
      taskRevision: task.revision,
      scheduledFor: task.nextRunAt,
    });
    expect(bot.initialize).toHaveBeenCalledTimes(1);
    expect(bot.initialize.mock.invocationCallOrder[0]!).toBeLessThan(
      mockAgentScheduleDbService.createTaskRun.mock.invocationCallOrder[0]!,
    );
    expect(mockAgentMemoryService.buildContext).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      timeZone: 'Europe/Warsaw',
      shortTermMemory: [
        {
          role: 'user',
          text: 'I prefer short reminders.',
        },
        {
          role: 'user',
          text: task.prompt,
          timestamp: expect.any(Number),
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
    expect(thread.post).toHaveBeenCalledWith({ raw: 'Tennis starts at 7pm.' });
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
    expect(mockAgentScheduleDbService.finishSuccessfulTaskRun).toHaveBeenCalledWith({
      task,
      runId: 'run-1',
      claimToken,
      output: 'Tennis starts at 7pm.',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: undefined,
    });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'sent',
    });
  });

  it('does not deliver a task cancelled while its message is being generated', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const cancelledTask = {
      ...task,
      status: 'cancelled' as const,
      revision: task.revision + 1,
      cancelledAt: new Date('2026-07-06T17:00:15.000Z'),
      updatedAt: new Date('2026-07-06T17:00:15.000Z'),
    };
    const thread = createThread();
    const bot = createBot({ thread });

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValue(cancelledTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockResolvedValue({ text: 'Time for tennis.' });

    const result = await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(thread.post).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.markTaskRunSkipped).toHaveBeenCalledWith({
      runId: 'run-1',
      claimToken: expect.any(String),
      reason: 'task_changed_before_delivery',
    });
    expect(result).toEqual({
      taskId: task.id,
      status: 'skipped',
      reason: 'task_changed_before_delivery',
    });
  });

  it('regenerates a one-time task when its content changes before delivery', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const revisedTask = {
      ...task,
      title: 'Updated tennis reminder',
      prompt: 'Remind the user to bring a fresh grip to tennis.',
      revision: task.revision + 1,
      updatedAt: new Date('2026-07-06T17:00:15.000Z'),
    };
    const thread = createThread();

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValue(revisedTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate
      .mockResolvedValueOnce({ text: 'Old reminder.' })
      .mockResolvedValue({ text: 'Bring a fresh grip to tennis.' });

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot({ thread }) as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).toHaveBeenCalledTimes(2);
    expect(mockAgentService.generate.mock.calls[1][0].messages.at(-1)?.content).toContain(
      revisedTask.prompt,
    );
    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(thread.post).toHaveBeenCalledWith({ raw: 'Bring a fresh grip to tennis.' });
    expect(mockAgentScheduleDbService.markTaskRunSkipped).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.finishSuccessfulTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        task: revisedTask,
        output: 'Bring a fresh grip to tennis.',
      }),
    );
    expect(result).toEqual({ taskId: task.id, status: 'sent' });
  });

  it('regenerates a recurring task when its allowed side effects change before delivery', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'recurring',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      recurrence: {
        frequency: 'daily',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        timeOfDay: '19:00',
      },
    });
    const revisedTask = {
      ...task,
      metadata: {
        ...task.metadata,
        allowedSideEffects: ['calendar.create'],
      },
      revision: task.revision + 1,
      updatedAt: new Date('2026-07-06T17:00:15.000Z'),
    };
    const thread = createThread();

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValue(revisedTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate
      .mockResolvedValueOnce({ text: 'Old recurring reminder.' })
      .mockResolvedValue({ text: 'Calendar event created.' });

    await AgentScheduleRunner.executeTask({
      bot: createBot({ thread }) as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).toHaveBeenCalledTimes(2);
    expect(mockAgentService.generate.mock.calls[1][0]).toEqual(
      expect.objectContaining({ scheduledTaskSideEffects: ['calendar.create'] }),
    );
    expect(thread.post).toHaveBeenCalledWith({ raw: 'Calendar event created.' });
    expect(mockAgentScheduleDbService.finishSuccessfulTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        task: revisedTask,
        nextRunAt: new Date('2026-07-07T17:00:00.000Z'),
      }),
    );
  });

  it('regenerates when the revision changes at the pre-post lease fence', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const revisedTask = {
      ...task,
      prompt: 'Use the revision committed immediately before posting.',
      revision: task.revision + 1,
    };
    const thread = createThread();

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(revisedTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentScheduleDbService.renewTaskRunLease
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    mockAgentService.generate
      .mockResolvedValueOnce({ text: 'Output from the old revision.' })
      .mockResolvedValue({ text: 'Output from the fenced revision.' });

    await AgentScheduleRunner.executeTask({
      bot: createBot({ thread }) as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentService.generate).toHaveBeenCalledTimes(2);
    expect(mockAgentScheduleDbService.renewTaskRunLease).toHaveBeenCalledTimes(2);
    expect(thread.post).toHaveBeenCalledTimes(1);
    expect(thread.post).toHaveBeenCalledWith({ raw: 'Output from the fenced revision.' });
  });

  it('retries when task revisions keep changing during bounded regeneration', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      metadata: { qstashFailureCallback: true },
    });
    const revision2 = { ...task, prompt: 'Revision 2', revision: 2 };
    const revision3 = { ...task, prompt: 'Revision 3', revision: 3 };
    const revision4 = { ...task, prompt: 'Revision 4', revision: 4 };
    const thread = createThread();

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(revision2)
      .mockResolvedValueOnce(revision3)
      .mockResolvedValue(revision4);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentService.generate.mockResolvedValue({ text: 'Changing output.' });

    await expect(
      AgentScheduleRunner.executeTask({
        bot: createBot({ thread }) as never,
        taskId: task.id,
        now: new Date('2026-07-06T17:00:30.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_EXECUTION_FAILED',
      retryable: true,
    });

    expect(mockAgentService.generate).toHaveBeenCalledTimes(3);
    expect(thread.post).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.markTaskRunSkipped).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.markTaskRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
    );
  });

  it('completes the current one-time revision when it changes after delivery', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const revisedTask = {
      ...task,
      title: 'Revised after delivery',
      revision: task.revision + 1,
    };
    const thread = createThread();

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(revisedTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentScheduleDbService.finishSuccessfulTaskRun.mockResolvedValue({ taskUpdated: false });
    mockAgentService.generate.mockResolvedValue({ text: 'Time for tennis.' });

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot({ thread }) as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentScheduleDbService.advanceTaskAfterRun).toHaveBeenCalledWith({
      task: revisedTask,
      outcome: 'success',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: undefined,
    });
    expect(result).toEqual({
      taskId: task.id,
      status: 'sent',
      reason: 'task_changed_after_delivery',
    });
  });

  it('advances the current recurring revision when it changes after delivery', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'recurring',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      recurrence: {
        frequency: 'daily',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        timeOfDay: '19:00',
      },
    });
    const revisedTask = {
      ...task,
      prompt: 'Use the revised recurring reminder.',
      revision: task.revision + 1,
    };

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(revisedTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentScheduleDbService.finishSuccessfulTaskRun.mockResolvedValue({ taskUpdated: false });
    mockAgentService.generate.mockResolvedValue({ text: 'Recurring reminder.' });

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot() as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentScheduleDbService.advanceTaskAfterRun).toHaveBeenCalledWith({
      task: revisedTask,
      outcome: 'success',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: new Date('2026-07-07T17:00:00.000Z'),
    });
    expect(result).toEqual({
      taskId: task.id,
      status: 'sent',
      reason: 'task_changed_after_delivery',
    });
  });

  it('does not post or advance when the run claim is lost before delivery', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const thread = createThread();

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentScheduleDbService.renewTaskRunLease.mockResolvedValue(false);
    mockAgentService.generate.mockResolvedValue({ text: 'Time for tennis.' });

    await expect(
      AgentScheduleRunner.executeTask({
        bot: createBot({ thread }) as never,
        taskId: task.id,
        now: new Date('2026-07-06T17:00:30.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'SCHEDULE_TASK_EXECUTION_FAILED',
      retryable: true,
    });

    expect(thread.post).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.markTaskRunFailed).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.advanceTaskAfterRun).not.toHaveBeenCalled();
  });

  it('does not overwrite a task rescheduled after its message was delivered', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const thread = createThread();
    const bot = createBot({ thread });
    const rescheduledTask = {
      ...task,
      revision: task.revision + 1,
      nextRunAt: new Date('2026-07-07T17:00:00.000Z'),
      updatedAt: new Date('2026-07-06T17:00:20.000Z'),
    };

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(rescheduledTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentScheduleDbService.finishSuccessfulTaskRun.mockResolvedValue({ taskUpdated: false });
    mockAgentService.generate.mockResolvedValue({ text: 'Time for tennis.' });

    const result = await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(thread.post).toHaveBeenCalledWith({ raw: 'Time for tennis.' });
    expect(mockAgentScheduleDbService.finishSuccessfulTaskRun).toHaveBeenCalledWith({
      task,
      runId: 'run-1',
      claimToken: expect.any(String),
      output: 'Time for tennis.',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: undefined,
    });
    expect(mockAgentScheduleDbService.advanceTaskAfterRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      taskId: task.id,
      status: 'sent',
      reason: 'task_changed_after_delivery',
    });
  });

  it('does not advance a replacement trigger that resolves to the same occurrence time', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'recurring',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      recurrence: {
        frequency: 'daily',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        timeOfDay: '19:00',
      },
      metadata: { qstashTriggerVersion: 'old-trigger' },
    });
    const replacementTriggerTask = {
      ...task,
      revision: task.revision + 1,
      metadata: { qstashTriggerVersion: 'replacement-trigger' },
    };

    mockAgentScheduleDbService.getTaskById
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValue(replacementTriggerTask);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    mockAgentScheduleDbService.finishSuccessfulTaskRun.mockResolvedValue({ taskUpdated: false });
    mockAgentService.generate.mockResolvedValue({ text: 'Old trigger reminder.' });

    const result = await AgentScheduleRunner.executeTask({
      bot: createBot() as never,
      taskId: task.id,
      triggerVersion: 'old-trigger',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentScheduleDbService.advanceTaskAfterRun).not.toHaveBeenCalled();
    expect(result).toEqual({
      taskId: task.id,
      status: 'sent',
      reason: 'task_changed_after_delivery',
    });
  });

  it('falls back to app memory when Chat SDK transcript retrieval fails', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'one_time',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
    });
    const bot = createBot();
    const transcriptError = new Error('state adapter unavailable');
    const fallbackMessages = [
      {
        role: 'user' as const,
        text: 'I finished task X yesterday.',
        timestamp: Date.parse('2026-07-06T12:00:00.000Z'),
      },
    ];

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue({
      id: 'run-1',
      taskId: task.id,
    });
    bot.transcripts.list.mockRejectedValue(transcriptError);
    mockAgentMemoryService.getRecentMessages.mockResolvedValue(fallbackMessages);
    mockAgentService.generate.mockResolvedValue({ text: 'Here is the current reminder.' });

    await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: task.id,
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentMemoryService.getRecentMessages).toHaveBeenCalledWith({
      identityId: task.identityId,
      threadId: task.threadId,
      limit: 200,
    });
    expect(mockAgentMemoryService.buildContext).toHaveBeenCalledWith({
      identityId: task.identityId,
      threadId: task.threadId,
      timeZone: task.timeZone,
      shortTermMemory: [
        ...fallbackMessages,
        {
          role: 'user',
          text: task.prompt,
          timestamp: expect.any(Number),
        },
      ],
    });
    expect(mockAgentService.generate).toHaveBeenCalled();
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
    expect(mockAgentScheduleDbService.advanceTaskAfterRun).toHaveBeenCalledWith({
      task,
      outcome: 'success',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: undefined,
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

    expect(thread.post).toHaveBeenCalledWith({ raw: 'Check your email.' });
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'sent',
    });
  });

  it('silently advances a recurring occurrence already satisfied by the user', async () => {
    const task = createTask({
      id: 'task-1',
      scheduleKind: 'recurring',
      nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      recurrence: {
        frequency: 'daily',
        daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        timeOfDay: '19:00',
      },
    });
    const bot = createBot();

    mockAgentScheduleDbService.getTaskById.mockResolvedValue(task);
    mockAgentScheduleDbService.createTaskRun.mockResolvedValue(null);
    mockAgentScheduleDbService.getTaskRunByScheduledFor.mockResolvedValue({
      id: 'run-1',
      taskId: 'task-1',
      scheduledFor: task.nextRunAt,
      status: 'satisfied',
    });

    const result = await AgentScheduleRunner.executeTask({
      bot: bot as never,
      taskId: 'task-1',
      now: new Date('2026-07-06T17:00:30.000Z'),
    });

    expect(mockAgentScheduleDbService.advanceTaskAfterRun).toHaveBeenCalledWith({
      task,
      outcome: 'success',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: new Date('2026-07-07T17:00:00.000Z'),
    });
    expect(mockAgentService.generate).not.toHaveBeenCalled();
    expect(bot.initialize).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      taskId: 'task-1',
      status: 'skipped',
      reason: 'already_satisfied',
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

    mockAgentScheduleDbService.finishSuccessfulTaskRun.mockRejectedValue(error);
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
    expect(thread.post).toHaveBeenCalledWith({ raw: 'Time to walk the dog.' });
    expect(mockAgentScheduleDbService.finishSuccessfulTaskRun).toHaveBeenCalledWith({
      task,
      runId: 'run-1',
      claimToken: expect.any(String),
      output: 'Time to walk the dog.',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: undefined,
    });
    expect(mockAgentScheduleDbService.markTaskRunFailed).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.advanceTaskAfterRun).not.toHaveBeenCalled();
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
      claimToken: expect.any(String),
      error,
    });
    expect(thread.post).not.toHaveBeenCalled();
    expect(mockAgentScheduleDbService.advanceTaskAfterRun).not.toHaveBeenCalled();
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
    expect(mockAgentScheduleDbService.advanceTaskAfterRun).toHaveBeenCalledWith({
      task,
      outcome: 'failure',
      ranAt: new Date('2026-07-06T17:00:30.000Z'),
      nextRunAt: undefined,
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

    expect(mockAgentScheduleDbService.advanceTaskAfterRun).toHaveBeenCalledWith({
      task,
      outcome: 'failure',
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
    revision: 1,
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

const mockAgentScheduleService = {
  createTask: jest.fn(),
  listTasks: jest.fn(),
  cancelTask: jest.fn(),
  formatTaskSchedule: jest.fn(),
};
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('ai', () => ({
  tool: jest.fn((definition) => definition),
}));

jest.mock('@/app/schedules', () => ({
  AgentScheduleService: mockAgentScheduleService,
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let manageScheduleTool: typeof import('@/app/schedules/tools').manageScheduleTool;

beforeAll(async () => {
  ({ manageScheduleTool } = await import('@/app/schedules/tools'));
});

describe('manageScheduleTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentScheduleService.formatTaskSchedule.mockReturnValue('today at 19:00 Europe/Warsaw');
  });

  it('creates scheduled tasks with runtime identity and thread context', async () => {
    mockAgentScheduleService.createTask.mockResolvedValue(
      createTask({
        id: 'task-1',
        title: 'Tennis reminder',
        prompt: 'Send the user a short reminder about their tennis game.',
        scheduleKind: 'one_time',
        nextRunAt: new Date('2026-07-06T17:00:00.000Z'),
      }),
    );

    const result = await executeManageScheduleTool({
      action: 'create',
      title: 'Tennis reminder',
      prompt: 'Send the user a short reminder about their tennis game.',
      schedule: {
        type: 'one_time',
        runAt: '2026-07-06T19:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      userFacingSchedule: 'today at 19:00 Europe/Warsaw',
    });

    expect(mockAgentScheduleService.createTask).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      title: 'Tennis reminder',
      prompt: 'Send the user a short reminder about their tennis game.',
      schedule: {
        type: 'one_time',
        runAt: '2026-07-06T19:00:00+02:00',
        timeZone: 'Europe/Warsaw',
      },
      sourceMessageId: 'message-1',
      userFacingSchedule: 'today at 19:00 Europe/Warsaw',
    });
    expect(result).toEqual({
      ok: true,
      message: 'Schedule confirmed: "Tennis reminder" is set for today at 19:00 Europe/Warsaw',
      task: {
        id: 'task-1',
        title: 'Tennis reminder',
        status: 'active',
        scheduleKind: 'one_time',
        timeZone: 'Europe/Warsaw',
        nextRunAt: '2026-07-06T17:00:00.000Z',
        scheduleSummary: 'today at 19:00 Europe/Warsaw',
        promptPreview: 'Send the user a short reminder about their tennis game.',
      },
    });
  });

  it('lists scheduled tasks for the current thread', async () => {
    mockAgentScheduleService.listTasks.mockResolvedValue([
      createTask({
        id: 'task-1',
        title: 'Daily todo prep',
        prompt: 'Ask the user to prepare their todo list.',
        scheduleKind: 'recurring',
        nextRunAt: new Date('2026-07-07T07:00:00.000Z'),
      }),
    ]);
    mockAgentScheduleService.formatTaskSchedule.mockReturnValue(
      'each weekday at 09:00 Europe/Warsaw',
    );

    const result = await executeManageScheduleTool({
      action: 'list',
      includeInactive: false,
      limit: 10,
    });

    expect(mockAgentScheduleService.listTasks).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      includeInactive: false,
      limit: 10,
    });
    expect(result).toEqual({
      ok: true,
      message: 'Loaded 1 scheduled task.',
      tasks: [
        {
          id: 'task-1',
          title: 'Daily todo prep',
          status: 'active',
          scheduleKind: 'recurring',
          timeZone: 'Europe/Warsaw',
          nextRunAt: '2026-07-07T07:00:00.000Z',
          scheduleSummary: 'each weekday at 09:00 Europe/Warsaw',
          promptPreview: 'Ask the user to prepare their todo list.',
        },
      ],
    });
  });

  it('cancels an active scheduled task', async () => {
    mockAgentScheduleService.cancelTask.mockResolvedValue(
      createTask({
        id: 'task-1',
        title: 'Daily todo prep',
        prompt: 'Ask the user to prepare their todo list.',
        scheduleKind: 'recurring',
        status: 'cancelled',
        nextRunAt: new Date('2026-07-07T07:00:00.000Z'),
      }),
    );

    const result = await executeManageScheduleTool({
      action: 'cancel',
      taskId: 'task-1',
      reason: 'User asked to stop it.',
    });

    expect(mockAgentScheduleService.cancelTask).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'telegram:1',
      taskId: 'task-1',
      reason: 'User asked to stop it.',
    });
    expect(result).toEqual({
      ok: true,
      message: 'Cancellation confirmed: "Daily todo prep" is cancelled.',
      task: {
        id: 'task-1',
        title: 'Daily todo prep',
        status: 'cancelled',
        scheduleKind: 'recurring',
        timeZone: 'Europe/Warsaw',
        nextRunAt: null,
        scheduleSummary: 'today at 19:00 Europe/Warsaw',
        promptPreview: 'Ask the user to prepare their todo list.',
      },
    });
  });
});

async function executeManageScheduleTool(
  input: Parameters<NonNullable<typeof manageScheduleTool.execute>>[0],
) {
  const execute = manageScheduleTool.execute;

  if (!execute) {
    throw new Error('Expected manageScheduleTool to expose execute.');
  }

  return execute(input, {
    context: {
      identityId: 'identity-1',
      threadId: 'telegram:1',
      sourceMessageId: 'message-1',
    },
  } as Parameters<typeof execute>[1]);
}

function createTask({
  id,
  title,
  prompt,
  scheduleKind,
  status = 'active',
  nextRunAt,
}: {
  id: string;
  title: string;
  prompt: string;
  scheduleKind: 'one_time' | 'recurring';
  status?: 'active' | 'completed' | 'cancelled' | 'failed';
  nextRunAt: Date;
}) {
  return {
    id,
    identityId: 'identity-1',
    threadId: 'telegram:1',
    title,
    prompt,
    scheduleKind,
    status,
    timeZone: 'Europe/Warsaw',
    nextRunAt,
    recurrence: {},
    sourceMessageId: 'message-1',
    metadata: {},
    lastRunAt: null,
    completedAt: null,
    cancelledAt: status === 'cancelled' ? new Date('2026-07-06T10:00:00.000Z') : null,
    failedAt: null,
    createdAt: new Date('2026-07-06T10:00:00.000Z'),
    updatedAt: new Date('2026-07-06T10:00:00.000Z'),
  };
}

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

    const messageId = await QStashService.scheduleOneTimeTask({
      taskId: '54fc072f-f5eb-4c04-a31f-df1f767fb5f1',
      runAt: new Date('2026-07-06T17:00:00.000Z'),
    });

    expect(messageId).toBe('msg-1');
    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://agent.example.com/jobs/schedules/execute',
        body: { taskId: '54fc072f-f5eb-4c04-a31f-df1f767fb5f1' },
        notBefore: 1783357200,
        failureCallback: 'https://agent.example.com/jobs/schedules/failure',
        deduplicationId: 'agent-schedule-54fc072f-f5eb-4c04-a31f-df1f767fb5f1',
      }),
    );
    expect(mockPublishJSON.mock.calls[0][0].deduplicationId).not.toContain(':');
  });
});

const mockAgentKnowledgeService = {
  createNode: jest.fn(),
  updateNodeByPath: jest.fn(),
  supersedeNodeByPath: jest.fn(),
};
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('ai', () => ({
  tool: jest.fn((definition) => definition),
}));

jest.mock('@/app/knowledge', () => ({
  AgentKnowledgeService: mockAgentKnowledgeService,
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let manageKnowledgeTool: typeof import('@/app/knowledge/tools').manageKnowledgeTool;

beforeAll(async () => {
  ({ manageKnowledgeTool } = await import('@/app/knowledge/tools'));
});

describe('manageKnowledgeTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates explicit knowledge notes with runtime identity context', async () => {
    mockAgentKnowledgeService.createNode.mockResolvedValue(
      createNode({
        id: 'node-1',
        path: 'profile/location',
        title: 'Default location',
        active: true,
      }),
    );

    const result = await executeManageKnowledgeTool({
      action: 'create',
      node: {
        parentPath: 'profile',
        title: 'Default location',
        content: 'Warsaw is the user default location.',
      },
    });

    expect(mockAgentKnowledgeService.createNode).toHaveBeenCalledWith({
      identityId: 'identity-1',
      parentPath: 'profile',
      slug: undefined,
      title: 'Default location',
      content: 'Warsaw is the user default location.',
      source: 'explicit',
      sourceMessageId: 'message-1',
    });
    expect(result).toEqual({
      ok: true,
      message: 'Saved knowledge note profile/location.',
      operationId: expect.any(String),
      node: {
        id: 'node-1',
        path: 'profile/location',
        title: 'Default location',
        active: true,
      },
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: expect.any(String),
        identityId: 'identity-1',
        sourceMessageId: 'message-1',
        input: expect.objectContaining({
          action: 'create',
          node: expect.objectContaining({
            parentPath: 'profile',
            title: 'Default location',
            content: expect.objectContaining({
              characterCount: 36,
              sha256: expect.any(String),
              preview: undefined,
            }),
          }),
        }),
      }),
      '[AGENT_KNOWLEDGE]: manage tool started',
    );
  });

  it('creates replacement knowledge and supersedes the old active path', async () => {
    mockAgentKnowledgeService.createNode.mockResolvedValue(
      createNode({
        id: 'node-2',
        path: 'work/company-y',
        title: 'Company Y',
        active: true,
      }),
    );
    mockAgentKnowledgeService.supersedeNodeByPath.mockResolvedValue(
      createNode({
        id: 'node-1',
        path: 'work/company-x',
        title: 'Company X',
        active: false,
      }),
    );

    const result = await executeManageKnowledgeTool({
      action: 'supersede',
      path: 'work/company-x',
      node: {
        parentPath: 'work',
        title: 'Company Y',
        content: 'The user currently works at Company Y.',
      },
    });

    expect(mockAgentKnowledgeService.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        parentPath: 'work',
        title: 'Company Y',
        source: 'explicit',
      }),
    );
    expect(mockAgentKnowledgeService.supersedeNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'work/company-x',
      supersededByPath: 'work/company-y',
    });
    expect(result).toEqual({
      ok: true,
      message: 'Superseded knowledge note work/company-x.',
      operationId: expect.any(String),
      node: {
        id: 'node-2',
        path: 'work/company-y',
        title: 'Company Y',
        active: true,
      },
      supersededNode: {
        id: 'node-1',
        path: 'work/company-x',
        title: 'Company X',
        active: false,
      },
    });
  });

  it('returns a debug operation id and logs attempted input when knowledge updates fail', async () => {
    const error = new Error('database unavailable');

    mockAgentKnowledgeService.createNode.mockRejectedValue(error);

    const result = await executeManageKnowledgeTool({
      action: 'create',
      node: {
        parentPath: 'profile',
        title: 'Gender',
        content: 'The user is male.',
      },
    });

    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/^Knowledge could not be updated\. Debug ID: /),
      operationId: expect.any(String),
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: expect.any(String),
        error,
        identityId: 'identity-1',
        sourceMessageId: 'message-1',
        input: expect.objectContaining({
          action: 'create',
          node: expect.objectContaining({
            parentPath: 'profile',
            title: 'Gender',
            content: expect.objectContaining({
              characterCount: 17,
              sha256: expect.any(String),
              preview: undefined,
            }),
          }),
        }),
      }),
      '[AGENT_KNOWLEDGE]: manage tool failed',
    );
  });
});

async function executeManageKnowledgeTool(
  input: Parameters<NonNullable<typeof manageKnowledgeTool.execute>>[0],
) {
  const execute = manageKnowledgeTool.execute;

  if (!execute) {
    throw new Error('Expected manageKnowledgeTool to expose execute.');
  }

  return execute(input, {
    context: {
      identityId: 'identity-1',
      sourceMessageId: 'message-1',
    },
  } as Parameters<typeof execute>[1]);
}

function createNode({
  id,
  path,
  title,
  active,
}: {
  id: string;
  path: string;
  title: string;
  active: boolean;
}) {
  return {
    id,
    identityId: 'identity-1',
    parentId: null,
    slug: path.split('/').at(-1) ?? path,
    path,
    depth: path.split('/').length - 1,
    title,
    content: '',
    active,
    supersededById: null,
    supersededAt: null,
    source: 'explicit',
    sourceMessageId: null,
    metadata: {},
    embedding: null,
    embeddingModel: null,
    embeddingContentHash: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

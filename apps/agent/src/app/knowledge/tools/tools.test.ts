const mockAgentKnowledgeService = {
  listNodes: jest.fn(),
  readNodeByPath: jest.fn(),
  exploreNodes: jest.fn(),
  createNode: jest.fn(),
  updateNodeByPath: jest.fn(),
  deactivateNodeByPath: jest.fn(),
  moveNodeByPath: jest.fn(),
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
let readKnowledgeTool: typeof import('@/app/knowledge/tools').readKnowledgeTool;

beforeAll(async () => {
  ({ manageKnowledgeTool, readKnowledgeTool } = await import('@/app/knowledge/tools'));
});

describe('readKnowledgeTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists knowledge notes for inspection requests', async () => {
    mockAgentKnowledgeService.listNodes.mockResolvedValue([
      createNode({
        id: 'node-1',
        path: 'work/current-role',
        title: 'Current role',
        active: true,
      }),
    ]);

    const result = await executeReadKnowledgeTool({
      action: 'list',
      parentPath: 'work',
      limit: 10,
    });

    expect(mockAgentKnowledgeService.listNodes).toHaveBeenCalledWith({
      identityId: 'identity-1',
      parentPath: 'work',
      includeInactive: undefined,
      limit: 10,
    });
    expect(result).toEqual({
      ok: true,
      message: 'Loaded 1 knowledge note.',
      operationId: expect.any(String),
      nodes: [
        {
          id: 'node-1',
          path: 'work/current-role',
          parentPath: 'work',
          title: 'Current role',
          active: true,
        },
      ],
    });
  });

  it('reads a knowledge note with content for correction requests', async () => {
    mockAgentKnowledgeService.readNodeByPath.mockResolvedValue(
      createNode({
        id: 'node-1',
        path: 'preferences/communication',
        title: 'Communication preference',
        content: 'The user prefers casual, concise answers.',
        active: true,
      }),
    );

    const result = await executeReadKnowledgeTool({
      action: 'read',
      path: 'preferences/communication',
    });

    expect(mockAgentKnowledgeService.readNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'preferences/communication',
      includeInactive: undefined,
    });
    expect(result).toEqual({
      ok: true,
      message: 'Loaded knowledge note preferences/communication.',
      operationId: expect.any(String),
      node: {
        id: 'node-1',
        path: 'preferences/communication',
        parentPath: 'preferences',
        title: 'Communication preference',
        content: 'The user prefers casual, concise answers.',
        active: true,
      },
    });
  });

  it('explores related knowledge notes with bounded previews', async () => {
    mockAgentKnowledgeService.exploreNodes.mockResolvedValue({
      nodes: [
        {
          ...createNode({
            id: 'node-1',
            path: 'projects/lab-agent',
            title: 'Lab Agent',
            content: 'Personal agent project overview.',
            active: true,
          }),
          relationship: 'start',
          depthFromStart: 0,
          childCount: 2,
        },
        {
          ...createNode({
            id: 'node-2',
            path: 'projects/lab-agent/knowledge-system',
            title: 'Knowledge System',
            content: 'Durable tree retrieval and memory decisions.',
            active: true,
          }),
          relationship: 'child',
          depthFromStart: 1,
          childCount: 0,
        },
      ],
      truncated: false,
      startPaths: ['projects/lab-agent'],
      suggestedNextPaths: ['projects/lab-agent'],
    });

    const result = await executeReadKnowledgeTool({
      action: 'explore',
      startPath: 'projects/lab-agent',
      query: 'knowledge retrieval',
      direction: 'descendants',
      maxDepth: 2,
      limit: 12,
    });

    expect(mockAgentKnowledgeService.exploreNodes).toHaveBeenCalledWith({
      identityId: 'identity-1',
      startPath: 'projects/lab-agent',
      query: 'knowledge retrieval',
      direction: 'descendants',
      maxDepth: 2,
      includeInactive: undefined,
      includeContentPreview: undefined,
      limit: 12,
    });
    expect(result).toEqual({
      ok: true,
      message: 'Explored 2 knowledge notes.',
      operationId: expect.any(String),
      nodes: [
        {
          id: 'node-1',
          path: 'projects/lab-agent',
          parentPath: 'projects',
          title: 'Lab Agent',
          contentPreview: 'Personal agent project overview.',
          relationship: 'start',
          depthFromStart: 0,
          childCount: 2,
          active: true,
        },
        {
          id: 'node-2',
          path: 'projects/lab-agent/knowledge-system',
          parentPath: 'projects/lab-agent',
          title: 'Knowledge System',
          contentPreview: 'Durable tree retrieval and memory decisions.',
          relationship: 'child',
          depthFromStart: 1,
          childCount: 0,
          active: true,
        },
      ],
      truncated: false,
      startPaths: ['projects/lab-agent'],
      suggestedNextPaths: ['projects/lab-agent'],
    });
  });
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
        parentPath: 'profile',
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

  it('deactivates knowledge notes for forget requests', async () => {
    mockAgentKnowledgeService.deactivateNodeByPath.mockResolvedValue(
      createNode({
        id: 'node-1',
        path: 'profile/old-location',
        title: 'Old location',
        active: false,
      }),
    );

    const result = await executeManageKnowledgeTool({
      action: 'deactivate',
      path: 'profile/old-location',
    });

    expect(mockAgentKnowledgeService.deactivateNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'profile/old-location',
    });
    expect(result).toEqual({
      ok: true,
      message: 'Deactivated knowledge note profile/old-location.',
      operationId: expect.any(String),
      node: {
        id: 'node-1',
        path: 'profile/old-location',
        parentPath: 'profile',
        title: 'Old location',
        active: false,
      },
    });
  });

  it('moves or renames knowledge notes while preserving runtime identity context', async () => {
    mockAgentKnowledgeService.moveNodeByPath.mockResolvedValue(
      createNode({
        id: 'node-1',
        path: 'projects/lab-agent/scheduling',
        title: 'Scheduling',
        active: true,
      }),
    );

    const result = await executeManageKnowledgeTool({
      action: 'move',
      path: 'ideas/agent-scheduling',
      move: {
        parentPath: 'projects/lab-agent',
        slug: 'scheduling',
        title: 'Scheduling',
      },
    });

    expect(mockAgentKnowledgeService.moveNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'ideas/agent-scheduling',
      newParentPath: 'projects/lab-agent',
      newSlug: 'scheduling',
      title: 'Scheduling',
    });
    expect(result).toEqual({
      ok: true,
      message: 'Moved knowledge note ideas/agent-scheduling to projects/lab-agent/scheduling.',
      operationId: expect.any(String),
      node: {
        id: 'node-1',
        path: 'projects/lab-agent/scheduling',
        parentPath: 'projects/lab-agent',
        title: 'Scheduling',
        active: true,
      },
    });
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
        parentPath: 'work',
        title: 'Company Y',
        active: true,
      },
      supersededNode: {
        id: 'node-1',
        path: 'work/company-x',
        parentPath: 'work',
        title: 'Company X',
        active: false,
      },
    });
  });

  it('returns a safe failure and logs attempted input when knowledge updates fail', async () => {
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
      message: 'Knowledge request could not be completed.',
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

async function executeReadKnowledgeTool(
  input: Parameters<NonNullable<typeof readKnowledgeTool.execute>>[0],
) {
  const execute = readKnowledgeTool.execute;

  if (!execute) {
    throw new Error('Expected readKnowledgeTool to expose execute.');
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
  content = '',
  active,
}: {
  id: string;
  path: string;
  title: string;
  content?: string;
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
    content,
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

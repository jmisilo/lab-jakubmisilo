import type {
  AgentKnowledgeContextNode,
  AgentKnowledgeExploreNode,
} from '@/infrastructure/db/services/agent-knowledge';

import { loggerMock as mockLogger } from '@/infrastructure/__mocks__/logger';
import { AppErrorCode } from '@/infrastructure/errors';

import type { AgentKnowledgeService as AgentKnowledgeServiceType } from '.';

const mockAgentKnowledgeDbService = {
  getNode: jest.fn(),
  getActiveNodeByPath: jest.fn(),
  getNodeByPath: jest.fn(),
  listNodes: jest.fn(),
  createNode: jest.fn(),
  replaceNode: jest.fn(),
  updateNodeContent: jest.fn(),
  supersedeNode: jest.fn(),
  moveNode: jest.fn(),
  findActiveNodeByPath: jest.fn(),
  getRelevantContextNodes: jest.fn(),
  findRelevantMatches: jest.fn(),
  exploreNodes: jest.fn(),
};

const mockAIService = {
  embeddingModel: 'text-embedding-3-small',
  embed: jest.fn(),
  generate: jest.fn(),
};

jest.mock('@/infrastructure/db/services/agent-knowledge', () => ({
  AgentKnowledgeDbService: mockAgentKnowledgeDbService,
}));

jest.mock('@/infrastructure/ai', () => ({
  AIService: mockAIService,
}));

jest.mock('ai', () => ({
  Output: {
    object: jest.fn((input: Record<string, unknown>) => ({
      type: 'object-output',
      ...input,
    })),
  },
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: mockLogger,
}));

let AgentKnowledgeService: typeof AgentKnowledgeServiceType;

beforeAll(async () => {
  ({ AgentKnowledgeService } = await import('.'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AgentKnowledgeService', () => {
  it('applies an explicit create mutation through one public outcome', async () => {
    const node = createKnowledgeContextNode({
      title: 'Default location',
      content: 'Warsaw is the user default location.',
    });

    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.createNode.mockResolvedValue(node);

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'create',
      identityId: 'identity-1',
      sourceMessageId: 'message-1',
      node: {
        title: ' Default location ',
        content: ' Warsaw is the user default location. ',
      },
    });

    expect(outcome).toEqual({
      action: 'create',
      node,
    });
    expect(mockAIService.embed).toHaveBeenCalledWith(
      expect.stringContaining('Title: Default location'),
    );
    expect(mockAgentKnowledgeDbService.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        title: 'Default location',
        content: 'Warsaw is the user default location.',
        source: 'explicit',
        sourceMessageId: 'message-1',
        embedding: [0.1, 0.2, 0.3],
        embeddingModel: 'text-embedding-3-small',
        embeddingContentHash: expect.any(String),
      }),
    );
  });

  it('rejects an explicit create when persistence returns no node', async () => {
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.createNode.mockResolvedValue(null);

    await expect(
      AgentKnowledgeService.applyExplicitMutation({
        action: 'create',
        identityId: 'identity-1',
        sourceMessageId: 'message-1',
        node: {
          title: 'Default location',
          content: 'Warsaw is the user default location.',
        },
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
    });
  });

  it('prepares and applies an explicit replacement as one persistence outcome', async () => {
    const supersededNode = {
      ...createKnowledgeContextNode({
        id: 'company-x-node',
        path: 'work/company-x',
        title: 'Company X',
        content: 'The user currently works at Company X.',
      }),
      active: false,
    };
    const replacementNode = createKnowledgeContextNode({
      id: 'company-y-node',
      path: 'work/company-y',
      title: 'Company Y',
      content: 'The user currently works at Company Y.',
    });

    mockAgentKnowledgeDbService.getActiveNodeByPath.mockResolvedValue(
      createKnowledgeContextNode({
        id: 'company-x-node',
        path: 'work/company-x',
        title: 'Company X',
        content: 'The user currently works at Company X.',
      }),
    );
    mockAgentKnowledgeDbService.findActiveNodeByPath.mockResolvedValue(
      createKnowledgeContextNode({
        id: 'work-node',
        path: 'work',
        title: 'Work',
        content: 'Knowledge group for work.',
      }),
    );
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.replaceNode.mockResolvedValue({
      replacementNode,
      supersededNode,
    });

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'supersede',
      identityId: 'identity-1',
      sourceMessageId: 'message-1',
      path: '/work/company-x/',
      node: {
        parentPath: '/work/',
        slug: 'company-y',
        title: ' Company Y ',
        content: ' The user currently works at Company Y. ',
      },
    });

    expect(outcome).toEqual({
      action: 'supersede',
      node: replacementNode,
      supersededNode,
    });
    expect(mockAgentKnowledgeDbService.replaceNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        nodeId: 'company-x-node',
        replacement: expect.objectContaining({
          parentId: 'work-node',
          slug: 'company-y',
          title: 'Company Y',
          content: 'The user currently works at Company Y.',
          source: 'explicit',
          sourceMessageId: 'message-1',
          embedding: [0.1, 0.2, 0.3],
          embeddingModel: 'text-embedding-3-small',
          embeddingContentHash: expect.any(String),
        }),
      }),
    );
    expect(mockAgentKnowledgeDbService.createNode).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.supersedeNode).not.toHaveBeenCalled();
  });

  it('applies an explicit update mutation by normalized path', async () => {
    const currentNode = createKnowledgeContextNode({
      id: 'preference-node',
      path: 'preferences/communication',
      title: 'Communication preference',
      content: 'The user prefers detailed answers.',
    });
    const updatedNode = {
      ...currentNode,
      content: 'The user prefers concise answers.',
    };

    mockAgentKnowledgeDbService.getActiveNodeByPath.mockResolvedValue(currentNode);
    mockAgentKnowledgeDbService.getNode.mockResolvedValue(currentNode);
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.updateNodeContent.mockResolvedValue(updatedNode);

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'update',
      identityId: 'identity-1',
      path: '/preferences/communication/',
      update: {
        content: ' The user prefers concise answers. ',
      },
    });

    expect(outcome).toEqual({
      action: 'update',
      node: updatedNode,
    });
    expect(mockAgentKnowledgeDbService.updateNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        nodeId: 'preference-node',
        content: 'The user prefers concise answers.',
        embedding: [0.1, 0.2, 0.3],
      }),
    );
  });

  it('applies an explicit deactivate mutation without deleting history', async () => {
    const activeNode = createKnowledgeContextNode({
      id: 'location-node',
      path: 'profile/location',
      title: 'Default location',
      content: 'Warsaw is the user default location.',
    });
    const deactivatedNode = {
      ...activeNode,
      active: false,
    };

    mockAgentKnowledgeDbService.getActiveNodeByPath.mockResolvedValue(activeNode);
    mockAgentKnowledgeDbService.supersedeNode.mockResolvedValue(deactivatedNode);

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'deactivate',
      identityId: 'identity-1',
      path: '/profile/location/',
    });

    expect(outcome).toEqual({
      action: 'deactivate',
      node: deactivatedNode,
    });
    expect(mockAgentKnowledgeDbService.supersedeNode).toHaveBeenCalledWith({
      identityId: 'identity-1',
      nodeId: 'location-node',
    });
  });

  it('applies an explicit move mutation while preserving the previous path in the command', async () => {
    const currentNode = createKnowledgeContextNode({
      id: 'scheduling-node',
      path: 'ideas/agent-scheduling',
      title: 'Agent scheduling',
      content: 'Build recurring jobs for the agent.',
    });
    const parentNode = createKnowledgeContextNode({
      id: 'lab-agent-node',
      path: 'projects/lab-agent',
      title: 'Lab Agent',
      content: 'Knowledge group for the lab agent.',
    });
    const movedNode = {
      ...currentNode,
      parentId: parentNode.id,
      path: 'projects/lab-agent/scheduling',
      title: 'Scheduling',
    };

    mockAgentKnowledgeDbService.getActiveNodeByPath.mockResolvedValue(currentNode);
    mockAgentKnowledgeDbService.findActiveNodeByPath
      .mockResolvedValueOnce(
        createKnowledgeContextNode({
          id: 'projects-node',
          path: 'projects',
          title: 'Projects',
          content: 'Knowledge group for projects.',
        }),
      )
      .mockResolvedValueOnce(parentNode);
    mockAIService.embed.mockResolvedValue([0.7, 0.8, 0.9]);
    mockAgentKnowledgeDbService.moveNode.mockResolvedValue(movedNode);

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'move',
      identityId: 'identity-1',
      path: '/ideas/agent-scheduling/',
      move: {
        parentPath: '/projects/lab-agent/',
        slug: 'scheduling',
        title: ' Scheduling ',
      },
    });

    expect(outcome).toEqual({
      action: 'move',
      previousPath: '/ideas/agent-scheduling/',
      node: movedNode,
    });
    expect(mockAgentKnowledgeDbService.moveNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        nodeId: 'scheduling-node',
        parentId: 'lab-agent-node',
        slug: 'scheduling',
        title: 'Scheduling',
        embedding: [0.7, 0.8, 0.9],
        embeddingModel: 'text-embedding-3-small',
        embeddingContentHash: expect.any(String),
      }),
    );
    expect(mockAIService.embed).toHaveBeenCalledWith(expect.stringContaining('Title: Scheduling'));
  });

  it('links an explicit supersession to an existing active replacement', async () => {
    const currentNode = createKnowledgeContextNode({
      id: 'company-x-node',
      path: 'work/company-x',
      title: 'Company X',
      content: 'The user previously worked at Company X.',
    });
    const replacementNode = createKnowledgeContextNode({
      id: 'company-y-node',
      path: 'work/company-y',
      title: 'Company Y',
      content: 'The user currently works at Company Y.',
    });
    const supersededNode = {
      ...currentNode,
      active: false,
      supersededById: replacementNode.id,
    };

    mockAgentKnowledgeDbService.getActiveNodeByPath
      .mockResolvedValueOnce(currentNode)
      .mockResolvedValueOnce(replacementNode);
    mockAgentKnowledgeDbService.supersedeNode.mockResolvedValue(supersededNode);

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'supersede',
      identityId: 'identity-1',
      path: '/work/company-x/',
      supersededByPath: '/work/company-y/',
    });

    expect(outcome).toEqual({
      action: 'supersede',
      node: null,
      supersededNode,
    });
    expect(mockAgentKnowledgeDbService.supersedeNode).toHaveBeenCalledWith({
      identityId: 'identity-1',
      nodeId: 'company-x-node',
      supersededById: 'company-y-node',
    });
  });

  it('rejects self-supersession after paths are normalized', async () => {
    await expect(
      AgentKnowledgeService.applyExplicitMutation({
        action: 'supersede',
        identityId: 'identity-1',
        path: '/work/current-company/',
        supersededByPath: 'work/current-company',
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
      context: expect.objectContaining({
        identityId: 'identity-1',
      }),
    });

    expect(mockAgentKnowledgeDbService.getActiveNodeByPath).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.supersedeNode).not.toHaveBeenCalled();
  });

  it('creates a durable knowledge node without embedding when embedding generation fails', async () => {
    const error = new Error('embedding provider unavailable');
    const node = createKnowledgeContextNode({
      title: 'Default location',
      content: 'Warsaw is the user default location.',
    });

    mockAIService.embed.mockRejectedValue(error);
    mockAgentKnowledgeDbService.createNode.mockResolvedValue(node);

    await AgentKnowledgeService.applyExplicitMutation({
      action: 'create',
      identityId: 'identity-1',
      sourceMessageId: 'message-1',
      node: {
        title: 'Default location',
        content: 'Warsaw is the user default location.',
      },
    });

    expect(mockAgentKnowledgeDbService.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        title: 'Default location',
        content: 'Warsaw is the user default location.',
        source: 'explicit',
        sourceMessageId: 'message-1',
        embedding: undefined,
        embeddingModel: undefined,
        embeddingContentHash: undefined,
      }),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        operation: 'knowledge.create',
        safeError: expect.anything(),
      }),
      '[AGENT_KNOWLEDGE]: embedding generation failed',
    );
    const embeddingWarning = mockLogger.warn.mock.calls.find(
      ([, message]) => message === '[AGENT_KNOWLEDGE]: embedding generation failed',
    )?.[0];

    expect(embeddingWarning).not.toHaveProperty('error');
  });

  it('persists bounded long notes while embedding only a content excerpt', async () => {
    const longContent = [
      '## Idea',
      '',
      'a'.repeat(AgentKnowledgeService.embeddingContentCharacterLimit + 200),
      '',
      'tail marker that should not be embedded',
    ].join('\n');
    const node = createKnowledgeContextNode({
      title: 'Long project note',
      content: longContent,
    });

    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.createNode.mockResolvedValue(node);

    await AgentKnowledgeService.applyExplicitMutation({
      action: 'create',
      identityId: 'identity-1',
      sourceMessageId: 'message-1',
      node: {
        title: 'Long project note',
        content: longContent,
      },
    });

    const embeddedText = mockAIService.embed.mock.calls[0]?.[0];

    expect(embeddedText).toContain('[embedding excerpt truncated]');
    expect(embeddedText).not.toContain('tail marker that should not be embedded');
    expect(mockAgentKnowledgeDbService.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Long project note',
        content: longContent,
      }),
    );
  });

  it('rejects knowledge note content beyond the service write limit', async () => {
    await expect(
      AgentKnowledgeService.applyExplicitMutation({
        action: 'create',
        identityId: 'identity-1',
        node: {
          title: 'Too long note',
          content: 'a'.repeat(AgentKnowledgeService.nodeContentCharacterLimit + 1),
        },
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
      context: expect.objectContaining({
        field: 'content',
        maxCharacters: AgentKnowledgeService.nodeContentCharacterLimit,
      }),
    });

    expect(mockAIService.embed).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.createNode).not.toHaveBeenCalled();
  });

  it('auto-creates missing parent path segments before creating a child note', async () => {
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findActiveNodeByPath.mockResolvedValueOnce(null);
    mockAgentKnowledgeDbService.createNode
      .mockResolvedValueOnce(
        createKnowledgeContextNode({
          id: 'profile-node',
          path: 'profile',
          title: 'Profile',
          content: 'Knowledge group for profile.',
        }),
      )
      .mockResolvedValueOnce(
        createKnowledgeContextNode({
          id: 'gender-node',
          path: 'profile/gender',
          title: 'User gender',
          content: 'The user is male.',
        }),
      );

    const outcome = await AgentKnowledgeService.applyExplicitMutation({
      action: 'create',
      identityId: 'identity-1',
      sourceMessageId: 'message-1',
      node: {
        parentPath: 'profile',
        slug: 'gender',
        title: 'User gender',
        content: 'The user is male.',
      },
    });

    expect(outcome.node?.path).toBe('profile/gender');
    expect(mockAgentKnowledgeDbService.findActiveNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'profile',
    });
    expect(mockAgentKnowledgeDbService.createNode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        identityId: 'identity-1',
        parentId: null,
        slug: 'profile',
        title: 'Profile',
        content: 'Knowledge group for profile.',
        source: 'system',
        sourceMessageId: 'message-1',
        metadata: expect.objectContaining({
          autoCreated: true,
          autoCreatedReason: 'missing_parent_path',
          path: 'profile',
        }),
      }),
    );
    expect(mockAgentKnowledgeDbService.createNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identityId: 'identity-1',
        parentId: 'profile-node',
        slug: 'gender',
        title: 'User gender',
        content: 'The user is male.',
        source: 'explicit',
        sourceMessageId: 'message-1',
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        sourceMessageId: 'message-1',
        nodeId: 'profile-node',
      }),
      '[AGENT_KNOWLEDGE]: parent node auto-created',
    );
  });

  it('retrieves and formats relevant knowledge context from recent user messages', async () => {
    mockAIService.embed.mockResolvedValue([0.4, 0.5, 0.6]);
    mockAgentKnowledgeDbService.getRelevantContextNodes.mockResolvedValue([
      createKnowledgeContextNode({
        path: 'profile/location',
        title: 'Default location',
        content: 'Warsaw is the user default location.',
        relationship: 'match',
        similarity: 0.91234,
      }),
      createKnowledgeContextNode({
        path: 'profile',
        title: 'Profile',
        content: 'Stable user profile facts.',
        relationship: 'ancestor',
      }),
    ]);

    const items = await AgentKnowledgeService.getContextItems({
      identityId: 'identity-1',
      shortTermMemory: [
        { role: 'assistant', text: 'I can use remembered context.' },
        { role: 'user', text: 'What is my default location?' },
      ],
    });

    expect(mockAIService.embed).toHaveBeenCalledWith(
      expect.stringContaining('user: What is my default location?'),
    );
    expect(mockAgentKnowledgeDbService.getRelevantContextNodes).toHaveBeenCalledWith({
      identityId: 'identity-1',
      embedding: [0.4, 0.5, 0.6],
      matchLimit: AgentKnowledgeService.contextMatchLimit,
      minSimilarity: AgentKnowledgeService.contextMinSimilarity,
      childLimit: AgentKnowledgeService.contextChildLimit,
      siblingLimit: AgentKnowledgeService.contextSiblingLimit,
    });
    expect(items).toEqual([
      expect.stringContaining('[knowledge:match similarity=0.912] profile/location'),
      expect.stringContaining('[knowledge:ancestor] profile'),
    ]);
    expect(items[0]).toContain('Warsaw is the user default location.');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        retrievedKnowledgeNodeCount: 2,
      }),
      '[AGENT_KNOWLEDGE]: context retrieved',
    );
  });

  it('includes full retrieved knowledge content before memory context token budgeting', async () => {
    const longContent = [
      'Durable note starts here.',
      'a'.repeat(2_200),
      'tail marker beyond the old context preview cap',
    ].join('\n');

    mockAIService.embed.mockResolvedValue([0.4, 0.5, 0.6]);
    mockAgentKnowledgeDbService.getRelevantContextNodes.mockResolvedValue([
      createKnowledgeContextNode({
        path: 'projects/lab-agent/long-note',
        title: 'Long note',
        content: longContent,
        relationship: 'match',
        similarity: 0.91,
      }),
    ]);

    const items = await AgentKnowledgeService.getContextItems({
      identityId: 'identity-1',
      shortTermMemory: [{ role: 'user', text: 'What should you remember about the agent?' }],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Durable note starts here.');
    expect(items[0]).toContain('tail marker beyond the old context preview cap');
    expect(items[0]).not.toContain('[truncated]');
  });

  it('lists knowledge nodes with normalized parent paths and bounded limits', async () => {
    const node = createKnowledgeContextNode({
      path: 'work/current-role',
      title: 'Current role',
      content: 'The user works on the agent.',
    });

    mockAgentKnowledgeDbService.listNodes.mockResolvedValue([node]);

    const nodes = await AgentKnowledgeService.listNodes({
      identityId: 'identity-1',
      parentPath: '/work//',
      includeInactive: true,
      limit: 500,
    });

    expect(nodes).toEqual([node]);
    expect(mockAgentKnowledgeDbService.listNodes).toHaveBeenCalledWith({
      identityId: 'identity-1',
      parentPath: 'work',
      includeInactive: true,
      limit: 50,
    });
  });

  it('reads an existing knowledge node by normalized path', async () => {
    const node = createKnowledgeContextNode({
      path: 'profile/location',
      title: 'Default location',
      content: 'Warsaw is the user default location.',
    });

    mockAgentKnowledgeDbService.getNodeByPath.mockResolvedValue(node);

    await AgentKnowledgeService.readNodeByPath({
      identityId: 'identity-1',
      path: '/profile/location/',
      includeInactive: true,
    });

    expect(mockAgentKnowledgeDbService.getNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'profile/location',
      includeInactive: true,
    });
  });

  it('explores a normalized knowledge path with bounded traversal options', async () => {
    mockAgentKnowledgeDbService.getNodeByPath.mockResolvedValue(
      createKnowledgeContextNode({
        id: 'lab-agent-node',
        path: 'projects/lab-agent',
        title: 'Lab Agent',
        content: 'Personal agent project.',
      }),
    );
    mockAgentKnowledgeDbService.exploreNodes.mockResolvedValue([
      createKnowledgeExploreNode({
        id: 'lab-agent-node',
        path: 'projects/lab-agent',
        title: 'Lab Agent',
        content: 'Personal agent project.',
        relationship: 'start',
        depthFromStart: 0,
        childCount: 2,
      }),
      createKnowledgeExploreNode({
        id: 'knowledge-node',
        path: 'projects/lab-agent/knowledge-system',
        title: 'Knowledge System',
        content: 'Durable knowledge tree decisions.',
        relationship: 'child',
        depthFromStart: 1,
        childCount: 0,
      }),
    ]);

    const result = await AgentKnowledgeService.exploreNodes({
      identityId: 'identity-1',
      startPath: '/projects/lab-agent/',
      direction: 'descendants',
      maxDepth: 99,
      limit: 99,
    });

    expect(mockAIService.embed).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.getNodeByPath).toHaveBeenCalledWith({
      identityId: 'identity-1',
      path: 'projects/lab-agent',
      includeInactive: undefined,
    });
    expect(mockAgentKnowledgeDbService.exploreNodes).toHaveBeenCalledWith({
      identityId: 'identity-1',
      startNodeIds: ['lab-agent-node'],
      direction: 'descendants',
      maxDepth: AgentKnowledgeService.exploreMaxDepth,
      includeInactive: undefined,
      limit: AgentKnowledgeService.exploreCandidateFetchLimit,
    });
    expect(result).toEqual({
      nodes: [
        expect.objectContaining({
          path: 'projects/lab-agent',
          relationship: 'start',
        }),
        expect.objectContaining({
          path: 'projects/lab-agent/knowledge-system',
          relationship: 'child',
        }),
      ],
      truncated: false,
      startPaths: ['projects/lab-agent'],
      suggestedNextPaths: ['projects/lab-agent'],
    });
  });

  it('explores from query-selected start nodes when no path is known', async () => {
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findRelevantMatches.mockResolvedValue([
      createKnowledgeContextNode({
        id: 'retrieval-node',
        path: 'projects/lab-agent/retrieval',
        title: 'Retrieval',
        content: 'Knowledge retrieval decisions.',
        similarity: 0.91,
      }),
    ]);
    mockAgentKnowledgeDbService.exploreNodes.mockResolvedValue([
      createKnowledgeExploreNode({
        id: 'retrieval-node',
        path: 'projects/lab-agent/retrieval',
        title: 'Retrieval',
        content: 'Knowledge retrieval decisions.',
        relationship: 'start',
        depthFromStart: 0,
        childCount: 0,
      }),
    ]);

    const result = await AgentKnowledgeService.exploreNodes({
      identityId: 'identity-1',
      query: 'knowledge retrieval',
      limit: 1,
    });

    expect(mockAIService.embed).toHaveBeenCalledWith('knowledge retrieval');
    expect(mockAgentKnowledgeDbService.findRelevantMatches).toHaveBeenCalledWith({
      identityId: 'identity-1',
      embedding: [0.1, 0.2, 0.3],
      limit: AgentKnowledgeService.exploreQuerySeedLimit,
      minSimilarity: AgentKnowledgeService.exploreQueryMinSimilarity,
    });
    expect(mockAgentKnowledgeDbService.exploreNodes).toHaveBeenCalledWith(
      expect.objectContaining({
        startNodeIds: ['retrieval-node'],
        direction: undefined,
      }),
    );
    expect(result.nodes).toEqual([
      expect.objectContaining({
        path: 'projects/lab-agent/retrieval',
        relationship: 'start',
      }),
    ]);
  });

  it('skips retrieval when recent context has no user message', async () => {
    const items = await AgentKnowledgeService.getContextItems({
      identityId: 'identity-1',
      shortTermMemory: [{ role: 'assistant', text: 'Assistant-only state.' }],
    });

    expect(items).toEqual([]);
    expect(mockAIService.embed).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.getRelevantContextNodes).not.toHaveBeenCalled();
  });

  it('returns no knowledge items when retrieval fails', async () => {
    const error = new Error('embedding provider unavailable');

    mockAIService.embed.mockRejectedValue(error);

    const items = await AgentKnowledgeService.getContextItems({
      identityId: 'identity-1',
      shortTermMemory: [{ role: 'user', text: 'What should you remember?' }],
    });

    expect(items).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        safeError: expect.anything(),
      }),
      '[AGENT_KNOWLEDGE]: context retrieval failed',
    );
  });

  it('extracts high-confidence implicit knowledge after a conversation turn', async () => {
    mockAIService.generate.mockResolvedValue({
      output: {
        items: [
          {
            parentPath: null,
            slug: null,
            title: 'Approximate birth year',
            content: 'The user is 25 as of July 2026, so they were likely born in 2000 or 2001.',
            confidence: 0.91,
            reason: 'User stated their age.',
          },
        ],
      },
    });
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findRelevantMatches.mockResolvedValue([]);
    mockAgentKnowledgeDbService.createNode.mockResolvedValue(
      createKnowledgeContextNode({
        title: 'Approximate birth year',
        content: 'The user is 25 as of July 2026.',
      }),
    );

    await AgentKnowledgeService.extractImplicitKnowledge({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'I am 25 years old.',
      assistantMessage: 'Noted.',
    });

    expect(mockAIService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.anything(),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Current date:'),
          }),
        ],
      }),
    );
    expect(mockAgentKnowledgeDbService.findRelevantMatches).toHaveBeenCalledWith({
      identityId: 'identity-1',
      embedding: [0.1, 0.2, 0.3],
      limit: AgentKnowledgeService.implicitMergeCandidateLimit,
      minSimilarity: AgentKnowledgeService.implicitMergeMinSimilarity,
    });
    expect(mockAgentKnowledgeDbService.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        parentId: null,
        title: 'Approximate birth year',
        content: 'The user is 25 as of July 2026, so they were likely born in 2000 or 2001.',
        source: 'implicit',
        sourceMessageId: 'message-1',
        metadata: expect.objectContaining({
          confidence: 0.91,
          threadId: 'thread-1',
        }),
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        createdKnowledgeNodeCount: 1,
      }),
      '[AGENT_KNOWLEDGE]: implicit knowledge extracted',
    );
  });

  it('feeds relevant existing paths into implicit knowledge extraction', async () => {
    mockAIService.generate.mockResolvedValue({
      output: {
        items: [],
      },
    });
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findRelevantMatches.mockResolvedValue([
      createKnowledgeContextNode({
        id: 'project-node',
        path: 'projects/lab-agent',
        title: 'Lab Agent',
        content: 'Knowledge group for the personal Telegram agent.',
        similarity: 0.82,
      }),
    ]);

    await AgentKnowledgeService.extractImplicitKnowledge({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'The scheduling module should support cron-like recurring jobs.',
      assistantMessage: 'Makes sense.',
    });

    expect(mockAgentKnowledgeDbService.findRelevantMatches).toHaveBeenCalledWith({
      identityId: 'identity-1',
      embedding: [0.1, 0.2, 0.3],
      limit: AgentKnowledgeService.implicitExtractionPathHintLimit,
      minSimilarity: AgentKnowledgeService.implicitExtractionPathHintMinSimilarity,
    });
    expect(mockAIService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('projects/lab-agent'),
          }),
        ],
      }),
    );
  });

  it('skips an implicit knowledge item when a nearby active note already covers it', async () => {
    mockAIService.generate
      .mockResolvedValueOnce({
        output: {
          items: [
            {
              parentPath: null,
              slug: null,
              title: 'User age',
              content: 'The user is 25 years old as of July 2026.',
              confidence: 0.91,
              reason: 'User stated their age.',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        output: {
          action: 'skip',
          targetPath: 'profile/age',
          parentPath: null,
          slug: null,
          title: null,
          content: null,
          reason: 'The candidate already stores the same age fact.',
        },
      });
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findRelevantMatches.mockResolvedValue([
      createKnowledgeContextNode({
        id: 'age-node',
        path: 'profile/age',
        title: 'User age',
        content: 'The user is 25 years old as of July 2026.',
        similarity: 0.93,
      }),
    ]);

    await AgentKnowledgeService.extractImplicitKnowledge({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'I am 25 years old.',
      assistantMessage: 'Noted.',
    });

    expect(mockAIService.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        output: expect.anything(),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('# Nearby Active Candidate Notes'),
          }),
        ],
      }),
    );
    expect(mockAgentKnowledgeDbService.createNode).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.updateNodeContent).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.supersedeNode).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'skip',
        candidateCount: 1,
      }),
      '[AGENT_KNOWLEDGE]: implicit ingestion decision',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        skippedKnowledgeItemCount: 1,
      }),
      '[AGENT_KNOWLEDGE]: implicit knowledge extracted',
    );
  });

  it('updates a selected nearby note for implicit knowledge that amends the same fact', async () => {
    mockAIService.generate
      .mockResolvedValueOnce({
        output: {
          items: [
            {
              parentPath: null,
              slug: null,
              title: 'Default location',
              content: 'The user lives in Warsaw and uses it as their default location.',
              confidence: 0.94,
              reason: 'User clarified their default location.',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        output: {
          action: 'update',
          targetPath: 'profile/location',
          parentPath: null,
          slug: null,
          title: 'Default location',
          content: 'The user lives in Warsaw and uses it as their default location.',
          reason: 'This amends the existing default-location note.',
        },
      });
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findRelevantMatches.mockResolvedValue([
      createKnowledgeContextNode({
        id: 'location-node',
        path: 'profile/location',
        title: 'Default location',
        content: 'Warsaw is the user default location.',
        similarity: 0.88,
      }),
    ]);
    mockAgentKnowledgeDbService.updateNodeContent.mockResolvedValue(
      createKnowledgeContextNode({
        id: 'location-node',
        path: 'profile/location',
        title: 'Default location',
        content: 'The user lives in Warsaw and uses it as their default location.',
      }),
    );

    await AgentKnowledgeService.extractImplicitKnowledge({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'I live in Warsaw, use it as my default location.',
      assistantMessage: 'Noted.',
    });

    expect(mockAgentKnowledgeDbService.updateNodeContent).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        nodeId: 'location-node',
        title: 'Default location',
        content: 'The user lives in Warsaw and uses it as their default location.',
        embedding: [0.1, 0.2, 0.3],
        embeddingModel: 'text-embedding-3-small',
      }),
    );
    expect(mockAgentKnowledgeDbService.createNode).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.supersedeNode).not.toHaveBeenCalled();
  });

  it('supersedes a selected nearby note when implicit knowledge replaces an old fact', async () => {
    mockAIService.generate
      .mockResolvedValueOnce({
        output: {
          items: [
            {
              parentPath: null,
              slug: null,
              title: 'Current company',
              content: 'The user currently works at Company Y.',
              confidence: 0.96,
              reason: 'User stated their current workplace.',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        output: {
          action: 'supersede',
          targetPath: 'work/current-company',
          parentPath: null,
          slug: null,
          title: 'Current company',
          content: 'The user currently works at Company Y.',
          reason: 'The new current workplace replaces the old active workplace fact.',
        },
      });
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.findRelevantMatches.mockResolvedValue([
      createKnowledgeContextNode({
        id: 'company-x-node',
        path: 'work/current-company',
        title: 'Current company',
        content: 'The user currently works at Company X.',
        similarity: 0.86,
      }),
    ]);
    const replacementNode = createKnowledgeContextNode({
      id: 'company-y-node',
      path: 'current-company',
      title: 'Current company',
      content: 'The user currently works at Company Y.',
    });
    const supersededNode = {
      ...createKnowledgeContextNode({
        id: 'company-x-node',
        path: 'work/current-company',
        title: 'Current company',
        content: 'The user currently works at Company X.',
      }),
      active: false,
      supersededById: 'company-y-node',
    };

    mockAgentKnowledgeDbService.replaceNode.mockResolvedValue({
      replacementNode,
      supersededNode,
    });

    await AgentKnowledgeService.extractImplicitKnowledge({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'I now work at Company Y.',
      assistantMessage: 'Noted.',
    });

    expect(mockAgentKnowledgeDbService.replaceNode).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        nodeId: 'company-x-node',
        replacement: expect.objectContaining({
          parentId: null,
          slug: undefined,
          title: 'Current company',
          content: 'The user currently works at Company Y.',
          source: 'implicit',
          sourceMessageId: 'message-1',
          metadata: expect.objectContaining({
            ingestionAction: 'supersede',
            targetPath: 'work/current-company',
            confidence: 0.96,
          }),
        }),
      }),
    );
    expect(mockAgentKnowledgeDbService.createNode).not.toHaveBeenCalled();
    expect(mockAgentKnowledgeDbService.supersedeNode).not.toHaveBeenCalled();
  });

  it('skips low-confidence implicit knowledge extraction items', async () => {
    mockAIService.generate.mockResolvedValue({
      output: {
        items: [
          {
            parentPath: null,
            slug: null,
            title: 'Weak guess',
            content: 'The user might like espresso.',
            confidence: 0.2,
            reason: null,
          },
        ],
      },
    });

    await AgentKnowledgeService.extractImplicitKnowledge({
      identityId: 'identity-1',
      threadId: 'thread-1',
      sourceMessageId: 'message-1',
      userMessage: 'Can you make this shorter?',
      assistantMessage: 'Sure.',
    });

    expect(mockAgentKnowledgeDbService.createNode).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        identityId: 'identity-1',
        threadId: 'thread-1',
      }),
      '[AGENT_KNOWLEDGE]: implicit extraction skipped',
    );
  });
});

function createKnowledgeContextNode({
  id = 'knowledge-node-1',
  path = 'profile/location',
  title,
  content,
  relationship = 'match',
  similarity,
}: {
  id?: string;
  path?: string;
  title: string;
  content: string;
  relationship?: AgentKnowledgeContextNode['relationship'];
  similarity?: number;
}): AgentKnowledgeContextNode {
  return {
    id,
    identityId: 'identity-1',
    parentId: null,
    slug: path.split('/').at(-1) ?? path,
    path,
    depth: path.split('/').length - 1,
    title,
    content,
    active: true,
    supersededById: null,
    supersededAt: null,
    source: 'explicit',
    sourceMessageId: null,
    metadata: {},
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: 'text-embedding-3-small',
    embeddingContentHash: 'hash',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    relationship,
    similarity,
  };
}

function createKnowledgeExploreNode({
  id = 'knowledge-node-1',
  path = 'profile/location',
  title,
  content,
  relationship,
  depthFromStart,
  childCount,
}: {
  id?: string;
  path?: string;
  title: string;
  content: string;
  relationship: AgentKnowledgeExploreNode['relationship'];
  depthFromStart: number;
  childCount: number;
}): AgentKnowledgeExploreNode {
  return {
    id,
    identityId: 'identity-1',
    parentId: null,
    slug: path.split('/').at(-1) ?? path,
    path,
    depth: path.split('/').length - 1,
    title,
    content,
    active: true,
    supersededById: null,
    supersededAt: null,
    source: 'explicit',
    sourceMessageId: null,
    metadata: {},
    embedding: [0.1, 0.2, 0.3],
    embeddingModel: 'text-embedding-3-small',
    embeddingContentHash: 'hash',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    relationship,
    depthFromStart,
    childCount,
  };
}

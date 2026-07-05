import type { AgentKnowledgeContextNode } from '@/infrastructure/db/services/agent-knowledge';

import { loggerMock as mockLogger } from '@/infrastructure/__mocks__/logger';

import type { AgentKnowledgeService as AgentKnowledgeServiceType } from '.';

const mockAgentKnowledgeDbService = {
  createNode: jest.fn(),
  updateNodeContent: jest.fn(),
  supersedeNode: jest.fn(),
  findActiveNodeByPath: jest.fn(),
  getRelevantContextNodes: jest.fn(),
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
  it('embeds node content before creating a durable knowledge node', async () => {
    const node = createKnowledgeContextNode({
      title: 'Default location',
      content: 'Warsaw is the user default location.',
    });

    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockAgentKnowledgeDbService.createNode.mockResolvedValue(node);

    await AgentKnowledgeService.createNode({
      identityId: 'identity-1',
      title: ' Default location ',
      content: ' Warsaw is the user default location. ',
      source: 'explicit',
      sourceMessageId: 'message-1',
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

    const node = await AgentKnowledgeService.createNode({
      identityId: 'identity-1',
      parentPath: 'profile',
      slug: 'gender',
      title: 'User gender',
      content: 'The user is male.',
      source: 'explicit',
      sourceMessageId: 'message-1',
    });

    expect(node?.path).toBe('profile/gender');
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
        path: 'profile',
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
        error,
      }),
      '[AGENT_KNOWLEDGE]: context retrieval failed',
    );
  });

  it('extracts high-confidence implicit knowledge after a conversation turn', async () => {
    mockAIService.generate.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            parentPath: null,
            title: 'Approximate birth year',
            content: 'The user is 25 as of July 2026, so they were likely born in 2000 or 2001.',
            confidence: 0.91,
            reason: 'User stated their age.',
          },
        ],
      }),
    );
    mockAIService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
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
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Current date:'),
          }),
        ],
      }),
    );
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

  it('skips low-confidence implicit knowledge extraction items', async () => {
    mockAIService.generate.mockResolvedValue(
      JSON.stringify({
        items: [
          {
            title: 'Weak guess',
            content: 'The user might like espresso.',
            confidence: 0.2,
          },
        ],
      }),
    );

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

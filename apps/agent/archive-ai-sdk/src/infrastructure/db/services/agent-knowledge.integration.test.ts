import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, dbPool } from '@/infrastructure/db/client';
import { agentKnowledgeNodeClosure, agentKnowledgeNodes } from '@/infrastructure/db/schema';
import { AgentKnowledgeDbService } from '@/infrastructure/db/services/agent-knowledge';
import { AppErrorCode } from '@/infrastructure/errors';

const describeIntegration =
  process.env.AGENT_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;

describeIntegration('AgentKnowledgeDbService integration', () => {
  const identityId = `test-knowledge-${randomUUID()}`;

  afterEach(async () => {
    await deleteTestKnowledge(identityId);
  });

  afterAll(async () => {
    await dbPool.end();
  });

  it('creates nested tree closure rows and expands relevant context around vector matches', async () => {
    const projects = await AgentKnowledgeDbService.createNode({
      identityId,
      title: 'Projects',
      content: 'All project knowledge.',
      embedding: createEmbedding(1),
      embeddingModel: 'test-embedding-model',
      embeddingContentHash: 'projects-hash',
    });

    expect(projects).not.toBeNull();

    const projectAlpha = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: projects?.id,
      title: 'Project Alpha',
      content: 'Project Alpha overview.',
      embedding: createEmbedding(2),
      embeddingModel: 'test-embedding-model',
      embeddingContentHash: 'project-alpha-hash',
    });

    expect(projectAlpha).not.toBeNull();

    const designSystem = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: projectAlpha?.id,
      title: 'Design System',
      content: 'Project Alpha uses a precise editorial design system.',
      embedding: createEmbedding(0),
      embeddingModel: 'test-embedding-model',
      embeddingContentHash: 'design-system-hash',
    });

    expect(designSystem).not.toBeNull();

    const prd = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: projectAlpha?.id,
      title: 'PRD',
      content: 'Project Alpha product requirements.',
      embedding: createEmbedding(3),
      embeddingModel: 'test-embedding-model',
      embeddingContentHash: 'prd-hash',
    });

    expect(prd).not.toBeNull();

    if (!projects || !projectAlpha || !designSystem || !prd) {
      throw new Error('Expected knowledge nodes to be created.');
    }

    const closureRows = await db
      .select()
      .from(agentKnowledgeNodeClosure)
      .where(eq(agentKnowledgeNodeClosure.descendantId, designSystem.id));

    expect(
      closureRows
        .map((row) => ({ ancestorId: row.ancestorId, depth: row.depth }))
        .sort((a, b) => a.depth - b.depth),
    ).toEqual([
      { ancestorId: designSystem.id, depth: 0 },
      { ancestorId: projectAlpha.id, depth: 1 },
      { ancestorId: projects.id, depth: 2 },
    ]);

    expect(designSystem.path).toBe('projects/project-alpha/design-system');

    const contextNodes = await AgentKnowledgeDbService.getRelevantContextNodes({
      identityId,
      embedding: createEmbedding(0),
      matchLimit: 1,
      childLimit: 5,
      siblingLimit: 5,
    });

    expect(contextNodes.map((node) => [node.path, node.relationship])).toEqual(
      expect.arrayContaining([
        ['projects', 'ancestor'],
        ['projects/project-alpha', 'ancestor'],
        ['projects/project-alpha/design-system', 'match'],
        ['projects/project-alpha/prd', 'sibling'],
      ]),
    );
  });

  it('moves a subtree and rewrites descendant paths and closure rows', async () => {
    const projects = await AgentKnowledgeDbService.createNode({
      identityId,
      title: 'Projects',
      content: 'All project knowledge.',
    });
    const ideas = await AgentKnowledgeDbService.createNode({
      identityId,
      title: 'Ideas',
      content: 'All idea notes.',
    });

    expect(projects).not.toBeNull();
    expect(ideas).not.toBeNull();

    if (!projects || !ideas) {
      throw new Error('Expected root knowledge nodes to be created.');
    }

    const labAgent = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: projects.id,
      title: 'Lab Agent',
      content: 'Personal agent project.',
    });
    const scheduling = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: ideas.id,
      title: 'Agent Scheduling',
      content: 'Scheduling idea.',
    });

    expect(labAgent).not.toBeNull();
    expect(scheduling).not.toBeNull();

    if (!labAgent || !scheduling) {
      throw new Error('Expected project and scheduling nodes to be created.');
    }

    const details = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: scheduling.id,
      title: 'Details',
      content: 'Recurring jobs should support cron syntax.',
    });

    expect(details).not.toBeNull();

    if (!details) {
      throw new Error('Expected detail node to be created.');
    }

    const movedScheduling = await AgentKnowledgeDbService.moveNode({
      identityId,
      nodeId: scheduling.id,
      parentId: labAgent.id,
      slug: 'scheduling',
      title: 'Scheduling',
    });
    const movedDetails = await AgentKnowledgeDbService.getNode({
      identityId,
      nodeId: details.id,
    });
    const detailClosureRows = await db
      .select()
      .from(agentKnowledgeNodeClosure)
      .where(eq(agentKnowledgeNodeClosure.descendantId, details.id));

    expect(movedScheduling.path).toBe('projects/lab-agent/scheduling');
    expect(movedDetails.path).toBe('projects/lab-agent/scheduling/details');
    expect(
      detailClosureRows
        .map((row) => ({ ancestorId: row.ancestorId, depth: row.depth }))
        .sort((a, b) => a.depth - b.depth),
    ).toEqual([
      { ancestorId: details.id, depth: 0 },
      { ancestorId: scheduling.id, depth: 1 },
      { ancestorId: labAgent.id, depth: 2 },
      { ancestorId: projects.id, depth: 3 },
    ]);
  });

  it('atomically creates a replacement and supersedes the previous active node', async () => {
    const previousNode = await AgentKnowledgeDbService.createNode({
      identityId,
      slug: 'company-x',
      title: 'Company X',
      content: 'The user currently works at Company X.',
    });

    expect(previousNode).not.toBeNull();

    if (!previousNode) {
      throw new Error('Expected the previous knowledge node to be created.');
    }

    const outcome = await AgentKnowledgeDbService.replaceNode({
      identityId,
      nodeId: previousNode.id,
      replacement: {
        parentId: null,
        slug: 'company-x',
        title: 'Company Y',
        content: 'The user currently works at Company Y.',
        source: 'explicit',
      },
    });

    expect(outcome.replacementNode).toMatchObject({
      identityId,
      path: 'company-x',
      active: true,
    });
    expect(outcome.supersededNode).toMatchObject({
      id: previousNode.id,
      active: false,
      supersededById: outcome.replacementNode.id,
    });

    const persistedPreviousNode = await AgentKnowledgeDbService.getNode({
      identityId,
      nodeId: previousNode.id,
    });

    expect(persistedPreviousNode).toMatchObject({
      active: false,
      supersededById: outcome.replacementNode.id,
    });
  });

  it('rejects an update when the active node was superseded before the write', async () => {
    const node = await AgentKnowledgeDbService.createNode({
      identityId,
      title: 'Communication preference',
      content: 'The user prefers detailed answers.',
    });

    expect(node).not.toBeNull();

    if (!node) {
      throw new Error('Expected a knowledge node to be created.');
    }

    await AgentKnowledgeDbService.supersedeNode({
      identityId,
      nodeId: node.id,
    });

    await expect(
      AgentKnowledgeDbService.updateNodeContent({
        identityId,
        nodeId: node.id,
        content: 'The user prefers concise answers.',
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
    });

    const persistedNode = await AgentKnowledgeDbService.getNode({
      identityId,
      nodeId: node.id,
    });

    expect(persistedNode.content).toBe('The user prefers detailed answers.');
  });

  it('rejects supersession when another writer already deactivated the node', async () => {
    const node = await AgentKnowledgeDbService.createNode({
      identityId,
      title: 'Previous company',
      content: 'The user previously worked at Company X.',
    });

    expect(node).not.toBeNull();

    if (!node) {
      throw new Error('Expected a knowledge node to be created.');
    }

    await AgentKnowledgeDbService.supersedeNode({
      identityId,
      nodeId: node.id,
    });

    await expect(
      AgentKnowledgeDbService.supersedeNode({
        identityId,
        nodeId: node.id,
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
    });
  });

  it('preserves a subtree when its non-leaf root is superseded or replaced', async () => {
    const root = await AgentKnowledgeDbService.createNode({
      identityId,
      title: 'Projects',
      content: 'Project knowledge.',
    });

    expect(root).not.toBeNull();

    if (!root) {
      throw new Error('Expected a root knowledge node to be created.');
    }

    const child = await AgentKnowledgeDbService.createNode({
      identityId,
      parentId: root.id,
      title: 'Lab Agent',
      content: 'Personal agent project.',
    });

    expect(child).not.toBeNull();

    if (!child) {
      throw new Error('Expected a child knowledge node to be created.');
    }

    await expect(
      AgentKnowledgeDbService.supersedeNode({
        identityId,
        nodeId: root.id,
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
      retryable: false,
    });
    await expect(
      AgentKnowledgeDbService.replaceNode({
        identityId,
        nodeId: root.id,
        replacement: {
          title: 'New Projects',
          content: 'Replacement project knowledge.',
        },
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
      retryable: false,
    });

    await expect(
      AgentKnowledgeDbService.getActiveNodeByPath({
        identityId,
        path: root.path,
      }),
    ).resolves.toMatchObject({ id: root.id, active: true });
    await expect(
      AgentKnowledgeDbService.getActiveNodeByPath({
        identityId,
        path: child.path,
      }),
    ).resolves.toMatchObject({ id: child.id, active: true });
  });

  it('rolls back deactivation when replacement insertion fails', async () => {
    const originalNode = await AgentKnowledgeDbService.createNode({
      identityId,
      slug: 'original-note',
      title: 'Original note',
      content: 'This active note must survive a failed replacement.',
    });

    expect(originalNode).not.toBeNull();

    if (!originalNode) {
      throw new Error('Expected the original knowledge node to be created.');
    }

    await expect(
      AgentKnowledgeDbService.replaceNode({
        identityId,
        nodeId: originalNode.id,
        replacement: {
          parentId: null,
          slug: 'failed-replacement',
          title: 'x'.repeat(181),
          content: 'This node must not survive a failed supersession.',
          source: 'explicit',
        },
      }),
    ).rejects.toBeDefined();

    await expect(
      AgentKnowledgeDbService.getActiveNodeByPath({
        identityId,
        path: originalNode.path,
      }),
    ).resolves.toMatchObject({
      id: originalNode.id,
      active: true,
      supersededById: null,
      supersededAt: null,
    });

    await expect(
      AgentKnowledgeDbService.getActiveNodeByPath({
        identityId,
        path: 'failed-replacement',
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
    });
  });
});

async function deleteTestKnowledge(identityId: string) {
  await db.delete(agentKnowledgeNodes).where(eq(agentKnowledgeNodes.identityId, identityId));
}

function createEmbedding(activeIndex: number) {
  const embedding = Array.from({ length: 1536 }, () => 0);
  embedding[activeIndex] = 1;

  return embedding;
}

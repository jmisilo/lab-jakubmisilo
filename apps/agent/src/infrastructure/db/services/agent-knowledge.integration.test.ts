import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, dbPool } from '@/infrastructure/db/client';
import { agentKnowledgeNodeClosure, agentKnowledgeNodes } from '@/infrastructure/db/schema';
import { AgentKnowledgeDbService } from '@/infrastructure/db/services/agent-knowledge';

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
});

async function deleteTestKnowledge(identityId: string) {
  await db.delete(agentKnowledgeNodes).where(eq(agentKnowledgeNodes.identityId, identityId));
}

function createEmbedding(activeIndex: number) {
  const embedding = Array.from({ length: 1536 }, () => 0);
  embedding[activeIndex] = 1;

  return embedding;
}

import type { AgentKnowledgeNode, AgentKnowledgeSource, NewAgentKnowledgeNode } from '@/types';

import { randomUUID } from 'node:crypto';

import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm/sql/functions';

import { agentKnowledgeNodeClosure, agentKnowledgeNodes } from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

export type AgentKnowledgeContextRelationship = 'match' | 'ancestor' | 'child' | 'sibling';

export type AgentKnowledgeContextNode = AgentKnowledgeNode & {
  relationship: AgentKnowledgeContextRelationship;
  similarity?: number;
};

type CreateKnowledgeNodeInput = {
  identityId: string;
  parentId?: string | null;
  slug?: string;
  title: string;
  content?: string;
  source?: AgentKnowledgeSource;
  sourceMessageId?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
};

type UpdateKnowledgeNodeContentInput = {
  identityId: string;
  nodeId: string;
  title?: string;
  content: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
};

type SupersedeKnowledgeNodeInput = {
  identityId: string;
  nodeId: string;
  supersededById?: string;
};

type GetRelevantContextNodesInput = {
  identityId: string;
  embedding: number[];
  matchLimit?: number;
  minSimilarity?: number;
  childLimit?: number;
  siblingLimit?: number;
};

type NodeMatch = AgentKnowledgeNode & {
  similarity: number;
};

export class AgentKnowledgeDbService extends DbService {
  static async getNode({ identityId, nodeId }: { identityId: string; nodeId: string }) {
    const [node] = await this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(eq(agentKnowledgeNodes.identityId, identityId), eq(agentKnowledgeNodes.id, nodeId)),
      )
      .limit(1);

    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
        message: 'Knowledge node was not found.',
        context: { identityId, nodeId },
        retryable: false,
      });
    }

    return node;
  }

  static async getActiveNodeByPath({ identityId, path }: { identityId: string; path: string }) {
    const node = await this.findActiveNodeByPath({ identityId, path });

    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
        message: 'Active knowledge node was not found by path.',
        context: { identityId, path },
        retryable: false,
      });
    }

    return node;
  }

  static async findActiveNodeByPath({ identityId, path }: { identityId: string; path: string }) {
    const [node] = await this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.path, path),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .limit(1);

    return node ?? null;
  }

  static async createNode(input: CreateKnowledgeNodeInput) {
    const id = randomUUID();
    const parent = await this.#getParentNode({
      identityId: input.identityId,
      parentId: input.parentId ?? null,
    });
    const slug = input.slug
      ? this.#normalizeSlug(input.slug)
      : await this.#resolveAvailableSlug({
          identityId: input.identityId,
          parentPath: parent?.path ?? null,
          title: input.title,
        });
    const path = this.#createPath({ parentPath: parent?.path ?? null, slug });
    const parentClosures = parent
      ? await this.#getClosureRowsForParent({
          identityId: input.identityId,
          parentId: parent.id,
        })
      : [];

    const node: NewAgentKnowledgeNode = {
      id,
      identityId: input.identityId,
      parentId: parent?.id ?? null,
      slug,
      path,
      depth: parent ? parent.depth + 1 : 0,
      title: input.title.trim(),
      content: input.content?.trim() ?? '',
      source: input.source ?? 'explicit',
      sourceMessageId: input.sourceMessageId,
      metadata: input.metadata ?? {},
      embedding: input.embedding,
      embeddingModel: input.embeddingModel,
      embeddingContentHash: input.embeddingContentHash,
    };
    const closureRows = [
      ...parentClosures.map((closure) => ({
        identityId: input.identityId,
        ancestorId: closure.ancestorId,
        descendantId: id,
        depth: closure.depth + 1,
      })),
      {
        identityId: input.identityId,
        ancestorId: id,
        descendantId: id,
        depth: 0,
      },
    ];
    return this.client.transaction(async (tx) => {
      const [createdNode] = await tx.insert(agentKnowledgeNodes).values(node).returning();
      await tx.insert(agentKnowledgeNodeClosure).values(closureRows);

      return createdNode ?? null;
    });
  }

  static async updateNodeContent({
    identityId,
    nodeId,
    title,
    content,
    embedding,
    embeddingModel,
    embeddingContentHash,
  }: UpdateKnowledgeNodeContentInput) {
    const [node] = await this.client
      .update(agentKnowledgeNodes)
      .set({
        title: title?.trim(),
        content: content.trim(),
        embedding,
        embeddingModel,
        embeddingContentHash,
        updatedAt: new Date(),
      })
      .where(
        and(eq(agentKnowledgeNodes.identityId, identityId), eq(agentKnowledgeNodes.id, nodeId)),
      )
      .returning();

    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
        message: 'Knowledge node was not found for content update.',
        context: { identityId, nodeId },
        retryable: false,
      });
    }

    return node;
  }

  static async supersedeNode({ identityId, nodeId, supersededById }: SupersedeKnowledgeNodeInput) {
    const [node] = await this.client
      .update(agentKnowledgeNodes)
      .set({
        active: false,
        supersededById,
        supersededAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(agentKnowledgeNodes.identityId, identityId), eq(agentKnowledgeNodes.id, nodeId)),
      )
      .returning();

    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
        message: 'Knowledge node was not found for supersession.',
        context: { identityId, nodeId, supersededById },
        retryable: false,
      });
    }

    return node;
  }

  static async getRelevantContextNodes({
    identityId,
    embedding,
    matchLimit = 3,
    minSimilarity = 0.35,
    childLimit = 8,
    siblingLimit = 8,
  }: GetRelevantContextNodesInput): Promise<AgentKnowledgeContextNode[]> {
    const matches = await this.#findRelevantMatches({
      identityId,
      embedding,
      limit: matchLimit,
      minSimilarity,
    });

    if (matches.length === 0) {
      return [];
    }

    const nodes = new Map<string, AgentKnowledgeContextNode>();

    for (const match of matches) {
      this.#setContextNode(nodes, {
        ...match,
        relationship: 'match',
        similarity: match.similarity,
      });
    }

    const matchIds = matches.map((node) => node.id);
    const ancestors = await this.#getAncestorNodes({ identityId, descendantIds: matchIds });

    for (const ancestor of ancestors) {
      this.#setContextNode(nodes, { ...ancestor, relationship: 'ancestor' });
    }

    const children = await this.#getChildNodes({
      identityId,
      parentIds: matchIds,
      limit: childLimit,
    });

    for (const child of children) {
      this.#setContextNode(nodes, { ...child, relationship: 'child' });
    }

    const siblingParentIds = this.#uniqueStrings(matches.flatMap((node) => node.parentId ?? []));
    const siblings = await this.#getSiblingNodes({
      identityId,
      parentIds: siblingParentIds,
      excludeIds: matchIds,
      limit: siblingLimit,
    });

    for (const sibling of siblings) {
      this.#setContextNode(nodes, { ...sibling, relationship: 'sibling' });
    }

    return [...nodes.values()].sort(this.#compareContextNodes);
  }

  static async #getParentNode({
    identityId,
    parentId,
  }: {
    identityId: string;
    parentId: string | null;
  }) {
    if (!parentId) {
      return null;
    }

    const [parent] = await this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.id, parentId),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .limit(1);

    if (!parent) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_PARENT_NOT_FOUND,
        message: 'Knowledge parent node was not found.',
        context: { identityId, parentId },
        retryable: false,
      });
    }

    return parent;
  }

  static async #getClosureRowsForParent({
    identityId,
    parentId,
  }: {
    identityId: string;
    parentId: string;
  }) {
    const closureRows = await this.client
      .select()
      .from(agentKnowledgeNodeClosure)
      .where(
        and(
          eq(agentKnowledgeNodeClosure.identityId, identityId),
          eq(agentKnowledgeNodeClosure.descendantId, parentId),
        ),
      );

    if (closureRows.length === 0) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
        message: 'Knowledge parent node has no closure rows.',
        context: { identityId, parentId },
        retryable: false,
      });
    }

    return closureRows;
  }

  static async #resolveAvailableSlug({
    identityId,
    parentPath,
    title,
  }: {
    identityId: string;
    parentPath: string | null;
    title: string;
  }) {
    const baseSlug = this.#normalizeSlug(title);

    for (let suffix = 0; suffix < 20; suffix += 1) {
      const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
      const path = this.#createPath({ parentPath, slug });
      const [existingNode] = await this.client
        .select({ id: agentKnowledgeNodes.id })
        .from(agentKnowledgeNodes)
        .where(
          and(
            eq(agentKnowledgeNodes.identityId, identityId),
            eq(agentKnowledgeNodes.path, path),
            eq(agentKnowledgeNodes.active, true),
          ),
        )
        .limit(1);

      if (!existingNode) {
        return slug;
      }
    }

    return `${baseSlug}-${randomUUID().slice(0, 8)}`;
  }

  static async #findRelevantMatches({
    identityId,
    embedding,
    limit,
    minSimilarity,
  }: {
    identityId: string;
    embedding: number[];
    limit: number;
    minSimilarity: number;
  }): Promise<NodeMatch[]> {
    const distance = cosineDistance(agentKnowledgeNodes.embedding, embedding);
    const similarity = sql<number>`1 - (${distance})`;

    return this.client
      .select({
        ...getTableColumns(agentKnowledgeNodes),
        similarity,
      })
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.active, true),
          isNotNull(agentKnowledgeNodes.embedding),
          sql`${similarity} >= ${minSimilarity}`,
        ),
      )
      .orderBy(asc(distance))
      .limit(limit);
  }

  static async #getAncestorNodes({
    identityId,
    descendantIds,
  }: {
    identityId: string;
    descendantIds: string[];
  }) {
    if (descendantIds.length === 0) {
      return [];
    }

    const rows = await this.client
      .select({
        ...getTableColumns(agentKnowledgeNodes),
      })
      .from(agentKnowledgeNodeClosure)
      .innerJoin(
        agentKnowledgeNodes,
        eq(agentKnowledgeNodeClosure.ancestorId, agentKnowledgeNodes.id),
      )
      .where(
        and(
          eq(agentKnowledgeNodeClosure.identityId, identityId),
          inArray(agentKnowledgeNodeClosure.descendantId, descendantIds),
          gt(agentKnowledgeNodeClosure.depth, 0),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodes.depth), asc(agentKnowledgeNodes.path));

    return rows;
  }

  static async #getChildNodes({
    identityId,
    parentIds,
    limit,
  }: {
    identityId: string;
    parentIds: string[];
    limit: number;
  }) {
    if (parentIds.length === 0 || limit === 0) {
      return [];
    }

    return this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          inArray(agentKnowledgeNodes.parentId, parentIds),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodes.path))
      .limit(limit);
  }

  static async #getSiblingNodes({
    identityId,
    parentIds,
    excludeIds,
    limit,
  }: {
    identityId: string;
    parentIds: string[];
    excludeIds: string[];
    limit: number;
  }) {
    if (parentIds.length === 0 || limit === 0) {
      return [];
    }

    return this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          inArray(agentKnowledgeNodes.parentId, parentIds),
          notInArray(agentKnowledgeNodes.id, excludeIds),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodes.path))
      .limit(limit);
  }

  static #setContextNode(
    nodes: Map<string, AgentKnowledgeContextNode>,
    node: AgentKnowledgeContextNode,
  ) {
    const existingNode = nodes.get(node.id);

    if (
      !existingNode ||
      this.#relationshipPriority(node) > this.#relationshipPriority(existingNode)
    ) {
      nodes.set(node.id, node);
    }
  }

  static #relationshipPriority(node: AgentKnowledgeContextNode) {
    const priority: Record<AgentKnowledgeContextRelationship, number> = {
      match: 4,
      ancestor: 3,
      child: 2,
      sibling: 1,
    };

    return priority[node.relationship];
  }

  static #compareContextNodes(a: AgentKnowledgeContextNode, b: AgentKnowledgeContextNode) {
    if (a.path === b.path) {
      return 0;
    }

    return a.path < b.path ? -1 : 1;
  }

  static #createPath({ parentPath, slug }: { parentPath: string | null; slug: string }) {
    return parentPath ? `${parentPath}/${slug}` : slug;
  }

  static #normalizeSlug(value: string) {
    const slug = value
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Knowledge node slug could not be derived from input.',
        context: { value },
        retryable: false,
      });
    }

    return slug;
  }

  static #uniqueStrings(values: string[]) {
    return [...new Set(values)];
  }
}

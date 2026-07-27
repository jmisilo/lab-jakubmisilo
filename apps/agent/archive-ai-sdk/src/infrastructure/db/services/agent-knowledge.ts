import type { db } from '@/infrastructure/db/client';
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
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm/sql/functions';

import { agentKnowledgeNodeClosure, agentKnowledgeNodes } from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

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

  static async getNodeByPath({
    identityId,
    path,
    includeInactive = false,
  }: GetKnowledgeNodeByPathInput) {
    const [node] = await this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.path, path),
          includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
        ),
      )
      .limit(1);

    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
        message: 'Knowledge node was not found by path.',
        context: { identityId, path, includeInactive },
        retryable: false,
      });
    }

    return node;
  }

  static async listNodes({
    identityId,
    parentPath,
    includeInactive = false,
    limit = 50,
  }: ListKnowledgeNodesInput) {
    const parent = parentPath
      ? await this.getNodeByPath({ identityId, path: parentPath, includeInactive })
      : null;

    return this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          parent
            ? eq(agentKnowledgeNodes.parentId, parent.id)
            : isNull(agentKnowledgeNodes.parentId),
          includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodes.path))
      .limit(limit);
  }

  static async createNode(input: CreateKnowledgeNodeInput) {
    return this.client.transaction((tx) =>
      this.#insertNode({
        client: tx,
        input,
      }),
    );
  }

  static async replaceNode({
    identityId,
    nodeId,
    replacement,
  }: ReplaceKnowledgeNodeInput): Promise<ReplaceKnowledgeNodeOutcome> {
    return this.client.transaction(async (tx) => {
      await this.#assertActiveLeafNode({
        client: tx,
        identityId,
        nodeId,
        operation: 'replacement',
      });

      const supersededAt = new Date();
      const [deactivatedNode] = await tx
        .update(agentKnowledgeNodes)
        .set({
          active: false,
          supersededAt,
          updatedAt: supersededAt,
        })
        .where(
          and(
            eq(agentKnowledgeNodes.identityId, identityId),
            eq(agentKnowledgeNodes.id, nodeId),
            eq(agentKnowledgeNodes.active, true),
          ),
        )
        .returning();

      if (!deactivatedNode) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
          message: 'Active knowledge node was not found for replacement.',
          context: { identityId, nodeId },
          retryable: false,
        });
      }

      const replacementNode = await this.#insertNode({
        client: tx,
        input: {
          identityId,
          ...replacement,
        },
      });

      if (!replacementNode) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
          message: 'Replacement knowledge node was not created.',
          context: { identityId, nodeId },
          retryable: true,
        });
      }

      const [supersededNode] = await tx
        .update(agentKnowledgeNodes)
        .set({
          supersededById: replacementNode.id,
          updatedAt: supersededAt,
        })
        .where(
          and(eq(agentKnowledgeNodes.identityId, identityId), eq(agentKnowledgeNodes.id, nodeId)),
        )
        .returning();

      if (!supersededNode) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
          message: 'Knowledge node replacement was not linked.',
          context: { identityId, nodeId, replacementNodeId: replacementNode.id },
          retryable: true,
        });
      }

      return {
        replacementNode,
        supersededNode,
      };
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
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.id, nodeId),
          eq(agentKnowledgeNodes.active, true),
        ),
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
    if (nodeId === supersededById) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'A knowledge node cannot supersede itself.',
        context: { identityId, nodeId },
        retryable: false,
      });
    }

    return this.client.transaction(async (tx) => {
      await this.#assertActiveLeafNode({
        client: tx,
        identityId,
        nodeId,
        operation: 'supersession',
      });

      if (supersededById) {
        await this.#getActiveNodeForMutation({
          client: tx,
          identityId,
          nodeId: supersededById,
        });
      }

      const supersededAt = new Date();
      const [node] = await tx
        .update(agentKnowledgeNodes)
        .set({
          active: false,
          supersededById,
          supersededAt,
          updatedAt: supersededAt,
        })
        .where(
          and(
            eq(agentKnowledgeNodes.identityId, identityId),
            eq(agentKnowledgeNodes.id, nodeId),
            eq(agentKnowledgeNodes.active, true),
          ),
        )
        .returning();

      if (!node) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
          message: 'Active knowledge node was not found for supersession.',
          context: { identityId, nodeId, supersededById },
          retryable: false,
        });
      }

      return node;
    });
  }

  static async moveNode({
    identityId,
    nodeId,
    parentId,
    slug,
    title,
    embedding,
    embeddingModel,
    embeddingContentHash,
  }: MoveKnowledgeNodeInput) {
    return this.client.transaction(async (tx) => {
      const node = await this.#getActiveNodeForMutation({
        client: tx,
        identityId,
        nodeId,
      });
      const parent = parentId
        ? await this.#getActiveNodeForMutation({
            client: tx,
            identityId,
            nodeId: parentId,
          })
        : null;
      const subtreeRows = await this.#getSubtreeRows({
        client: tx,
        identityId,
        nodeId,
      });

      if (parent && subtreeRows.some((subtreeNode) => subtreeNode.id === parent.id)) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
          message: 'Knowledge node cannot be moved below itself or one of its descendants.',
          context: { identityId, nodeId, parentId },
          retryable: false,
        });
      }

      const nextSlug = slug ? this.#normalizeSlug(slug) : node.slug;
      const nextPath = this.#createPath({ parentPath: parent?.path ?? null, slug: nextSlug });
      const parentClosures = parent
        ? await this.#getClosureRowsForParent({
            client: tx,
            identityId,
            parentId: parent.id,
          })
        : [];
      const subtreeIds = subtreeRows.map((subtreeNode) => subtreeNode.id);
      const nextDepth = parent ? parent.depth + 1 : 0;
      const depthDelta = nextDepth - node.depth;
      const nextPathByNodeId = new Map(
        subtreeRows.map((subtreeNode) => [
          subtreeNode.id,
          subtreeNode.id === node.id
            ? nextPath
            : `${nextPath}${subtreeNode.path.slice(node.path.length)}`,
        ]),
      );
      const [subtreePathConflict] = await tx
        .select({
          id: agentKnowledgeNodes.id,
          path: agentKnowledgeNodes.path,
        })
        .from(agentKnowledgeNodes)
        .where(
          and(
            eq(agentKnowledgeNodes.identityId, identityId),
            eq(agentKnowledgeNodes.active, true),
            inArray(agentKnowledgeNodes.path, [...nextPathByNodeId.values()]),
            notInArray(agentKnowledgeNodes.id, subtreeIds),
          ),
        )
        .limit(1);

      if (subtreePathConflict) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
          message: 'Knowledge subtree move would conflict with an existing active path.',
          context: {
            identityId,
            nodeId,
            conflictingPath: subtreePathConflict.path,
          },
          retryable: false,
        });
      }

      let movedNode: AgentKnowledgeNode | null = null;
      const updatedAt = new Date();

      for (const subtreeNode of subtreeRows) {
        const descendantPath = nextPathByNodeId.get(subtreeNode.id);

        if (!descendantPath) {
          throw new AppError({
            code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
            message: 'Knowledge subtree path could not be resolved.',
            context: { identityId, nodeId: subtreeNode.id },
            retryable: true,
          });
        }

        const update: Partial<NewAgentKnowledgeNode> = {
          path: descendantPath,
          depth: subtreeNode.depth + depthDelta,
          updatedAt,
        };

        if (subtreeNode.id === node.id) {
          update.parentId = parent?.id ?? null;
          update.slug = nextSlug;

          if (title !== undefined) {
            update.title = title.trim();
          }

          if (embedding !== undefined) {
            update.embedding = embedding;
            update.embeddingModel = embeddingModel;
            update.embeddingContentHash = embeddingContentHash;
          }
        }

        const [updatedNode] = await tx
          .update(agentKnowledgeNodes)
          .set(update)
          .where(
            and(
              eq(agentKnowledgeNodes.identityId, identityId),
              eq(agentKnowledgeNodes.id, subtreeNode.id),
              subtreeNode.id === node.id ? eq(agentKnowledgeNodes.active, true) : undefined,
            ),
          )
          .returning();

        if (subtreeNode.id === node.id) {
          movedNode = updatedNode ?? null;
        }
      }

      await tx
        .delete(agentKnowledgeNodeClosure)
        .where(
          and(
            eq(agentKnowledgeNodeClosure.identityId, identityId),
            inArray(agentKnowledgeNodeClosure.descendantId, subtreeIds),
            notInArray(agentKnowledgeNodeClosure.ancestorId, subtreeIds),
          ),
        );

      if (parentClosures.length > 0) {
        await tx.insert(agentKnowledgeNodeClosure).values(
          parentClosures.flatMap((parentClosure) =>
            subtreeRows.map((subtreeNode) => ({
              identityId,
              ancestorId: parentClosure.ancestorId,
              descendantId: subtreeNode.id,
              depth: parentClosure.depth + 1 + subtreeNode.depthFromMovedNode,
            })),
          ),
        );
      }

      if (!movedNode) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
          message: 'Knowledge node was not moved.',
          context: { identityId, nodeId },
          retryable: true,
        });
      }

      return movedNode;
    });
  }

  static async getRelevantContextNodes({
    identityId,
    embedding,
    matchLimit = 5,
    minSimilarity = 0.35,
    childLimit = 8,
    siblingLimit = 8,
  }: GetRelevantContextNodesInput): Promise<AgentKnowledgeContextNode[]> {
    const matches = await this.findRelevantMatches({
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

  static async findRelevantMatches({
    identityId,
    embedding,
    limit = 5,
    minSimilarity = 0.35,
  }: FindRelevantMatchesInput): Promise<AgentKnowledgeSimilarNode[]> {
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

  static async exploreNodes({
    identityId,
    startNodeIds,
    direction = 'auto',
    maxDepth = 2,
    includeInactive = false,
    limit = 80,
  }: ExploreKnowledgeNodesInput): Promise<AgentKnowledgeExploreNode[]> {
    if (startNodeIds.length === 0 || limit === 0) {
      return [];
    }

    const nodes = new Map<string, AgentKnowledgeExploreNode>();
    const startNodes = await this.#getExploreStartNodes({
      identityId,
      startNodeIds,
      includeInactive,
    });

    for (const node of startNodes) {
      this.#setExploreNode(nodes, {
        ...node,
        relationship: 'start',
        depthFromStart: 0,
        childCount: 0,
      });
    }

    if (direction === 'ancestors' || direction === 'auto' || direction === 'neighborhood') {
      const ancestors = await this.#getExploreAncestorNodes({
        identityId,
        startNodeIds,
        includeInactive,
      });

      for (const ancestor of ancestors) {
        this.#setExploreNode(nodes, ancestor);
      }
    }

    if (direction === 'children' || direction === 'descendants' || direction === 'auto') {
      const descendants = await this.#getExploreDescendantNodes({
        identityId,
        startNodeIds,
        maxDepth: direction === 'children' ? 1 : maxDepth,
        includeInactive,
      });

      for (const descendant of descendants) {
        this.#setExploreNode(nodes, descendant);
      }
    }

    if (direction === 'neighborhood') {
      const children = await this.#getExploreDescendantNodes({
        identityId,
        startNodeIds,
        maxDepth: 1,
        includeInactive,
      });

      for (const child of children) {
        this.#setExploreNode(nodes, child);
      }
    }

    if (direction === 'siblings' || direction === 'neighborhood') {
      const siblings = await this.#getExploreSiblingNodes({
        identityId,
        startNodes,
        includeInactive,
      });

      for (const sibling of siblings) {
        this.#setExploreNode(nodes, sibling);
      }
    }

    const exploredNodes = await this.#withChildCounts({
      identityId,
      nodes: [...nodes.values()],
      includeInactive,
    });

    return exploredNodes.sort(this.#compareExploreNodes).slice(0, limit);
  }

  static async #assertActiveLeafNode({
    client,
    identityId,
    nodeId,
    operation,
  }: {
    client: AgentKnowledgeMutationClient;
    identityId: string;
    nodeId: string;
    operation: 'replacement' | 'supersession';
  }) {
    await this.#getActiveNodeForMutation({
      client,
      identityId,
      nodeId,
    });
    const [child] = await client
      .select({ id: agentKnowledgeNodes.id })
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.parentId, nodeId),
        ),
      )
      .limit(1);

    if (child) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
        message: `A knowledge node with children cannot be used for ${operation}.`,
        context: { identityId, nodeId, operation },
        retryable: false,
      });
    }
  }

  static async #getActiveNodeForMutation({
    client,
    identityId,
    nodeId,
  }: {
    client: AgentKnowledgeMutationClient;
    identityId: string;
    nodeId: string;
  }) {
    const [node] = await client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.id, nodeId),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .limit(1)
      .for('update');

    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_NOT_FOUND,
        message: 'Active knowledge node was not found for mutation.',
        context: { identityId, nodeId },
        retryable: false,
      });
    }

    return node;
  }

  static async #insertNode({
    client,
    input,
  }: {
    client: AgentKnowledgeMutationClient;
    input: CreateKnowledgeNodeInput;
  }) {
    const id = randomUUID();
    const parent = await this.#getParentNode({
      client,
      identityId: input.identityId,
      parentId: input.parentId ?? null,
    });
    const slug = input.slug
      ? this.#normalizeSlug(input.slug)
      : await this.#resolveAvailableSlug({
          client,
          identityId: input.identityId,
          parentPath: parent?.path ?? null,
          title: input.title,
        });
    const path = this.#createPath({ parentPath: parent?.path ?? null, slug });
    const parentClosures = parent
      ? await this.#getClosureRowsForParent({
          client,
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
    const [createdNode] = await client.insert(agentKnowledgeNodes).values(node).returning();

    await client.insert(agentKnowledgeNodeClosure).values(closureRows);

    return createdNode ?? null;
  }

  static async #getParentNode({
    client = this.client,
    identityId,
    parentId,
  }: {
    client?: AgentKnowledgeMutationClient;
    identityId: string;
    parentId: string | null;
  }) {
    if (!parentId) {
      return null;
    }

    const [parent] = await client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          eq(agentKnowledgeNodes.id, parentId),
          eq(agentKnowledgeNodes.active, true),
        ),
      )
      .limit(1)
      .for('key share');

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

  static async #getSubtreeRows({
    client = this.client,
    identityId,
    nodeId,
  }: {
    client?: AgentKnowledgeMutationClient;
    identityId: string;
    nodeId: string;
  }) {
    const rows = await client
      .select({
        ...getTableColumns(agentKnowledgeNodes),
        depthFromMovedNode: agentKnowledgeNodeClosure.depth,
      })
      .from(agentKnowledgeNodeClosure)
      .innerJoin(
        agentKnowledgeNodes,
        eq(agentKnowledgeNodeClosure.descendantId, agentKnowledgeNodes.id),
      )
      .where(
        and(
          eq(agentKnowledgeNodeClosure.identityId, identityId),
          eq(agentKnowledgeNodeClosure.ancestorId, nodeId),
        ),
      )
      .orderBy(asc(agentKnowledgeNodeClosure.depth), asc(agentKnowledgeNodes.path));

    if (rows.length === 0) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
        message: 'Knowledge node has no closure rows.',
        context: { identityId, nodeId },
        retryable: false,
      });
    }

    return rows;
  }

  static async #getClosureRowsForParent({
    client = this.client,
    identityId,
    parentId,
  }: {
    client?: AgentKnowledgeMutationClient;
    identityId: string;
    parentId: string;
  }) {
    const closureRows = await client
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
    client = this.client,
    identityId,
    parentPath,
    title,
  }: {
    client?: AgentKnowledgeMutationClient;
    identityId: string;
    parentPath: string | null;
    title: string;
  }) {
    const baseSlug = this.#normalizeSlug(title);

    for (let suffix = 0; suffix < 20; suffix += 1) {
      const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
      const path = this.#createPath({ parentPath, slug });
      const [existingNode] = await client
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

  static async #getExploreStartNodes({
    identityId,
    startNodeIds,
    includeInactive,
  }: {
    identityId: string;
    startNodeIds: string[];
    includeInactive: boolean;
  }) {
    return this.client
      .select()
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          inArray(agentKnowledgeNodes.id, startNodeIds),
          includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodes.path));
  }

  static async #getExploreAncestorNodes({
    identityId,
    startNodeIds,
    includeInactive,
  }: {
    identityId: string;
    startNodeIds: string[];
    includeInactive: boolean;
  }): Promise<AgentKnowledgeExploreNode[]> {
    const rows = await this.client
      .select({
        ...getTableColumns(agentKnowledgeNodes),
        depthFromStart: agentKnowledgeNodeClosure.depth,
      })
      .from(agentKnowledgeNodeClosure)
      .innerJoin(
        agentKnowledgeNodes,
        eq(agentKnowledgeNodeClosure.ancestorId, agentKnowledgeNodes.id),
      )
      .where(
        and(
          eq(agentKnowledgeNodeClosure.identityId, identityId),
          inArray(agentKnowledgeNodeClosure.descendantId, startNodeIds),
          gt(agentKnowledgeNodeClosure.depth, 0),
          includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodeClosure.depth), asc(agentKnowledgeNodes.path));

    return rows.map((row) => ({
      ...row,
      relationship: 'ancestor',
      childCount: 0,
    }));
  }

  static async #getExploreDescendantNodes({
    identityId,
    startNodeIds,
    maxDepth,
    includeInactive,
  }: {
    identityId: string;
    startNodeIds: string[];
    maxDepth: number;
    includeInactive: boolean;
  }): Promise<AgentKnowledgeExploreNode[]> {
    if (maxDepth <= 0) {
      return [];
    }

    const rows = await this.client
      .select({
        ...getTableColumns(agentKnowledgeNodes),
        depthFromStart: agentKnowledgeNodeClosure.depth,
      })
      .from(agentKnowledgeNodeClosure)
      .innerJoin(
        agentKnowledgeNodes,
        eq(agentKnowledgeNodeClosure.descendantId, agentKnowledgeNodes.id),
      )
      .where(
        and(
          eq(agentKnowledgeNodeClosure.identityId, identityId),
          inArray(agentKnowledgeNodeClosure.ancestorId, startNodeIds),
          gt(agentKnowledgeNodeClosure.depth, 0),
          sql`${agentKnowledgeNodeClosure.depth} <= ${maxDepth}`,
          includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(agentKnowledgeNodeClosure.depth), asc(agentKnowledgeNodes.path));

    return rows.map((row) => ({
      ...row,
      relationship: row.depthFromStart === 1 ? 'child' : 'descendant',
      childCount: 0,
    }));
  }

  static async #getExploreSiblingNodes({
    identityId,
    startNodes,
    includeInactive,
  }: {
    identityId: string;
    startNodes: AgentKnowledgeNode[];
    includeInactive: boolean;
  }): Promise<AgentKnowledgeExploreNode[]> {
    if (startNodes.length === 0) {
      return [];
    }

    const startNodeIds = startNodes.map((node) => node.id);
    const parentIds = this.#uniqueStrings(
      startNodes.flatMap((node) => (node.parentId ? [node.parentId] : [])),
    );
    const siblings: AgentKnowledgeNode[] = [];

    if (parentIds.length > 0) {
      siblings.push(
        ...(await this.client
          .select()
          .from(agentKnowledgeNodes)
          .where(
            and(
              eq(agentKnowledgeNodes.identityId, identityId),
              inArray(agentKnowledgeNodes.parentId, parentIds),
              notInArray(agentKnowledgeNodes.id, startNodeIds),
              includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
            ),
          )
          .orderBy(asc(agentKnowledgeNodes.path))),
      );
    }

    if (startNodes.some((node) => node.parentId === null)) {
      siblings.push(
        ...(await this.client
          .select()
          .from(agentKnowledgeNodes)
          .where(
            and(
              eq(agentKnowledgeNodes.identityId, identityId),
              isNull(agentKnowledgeNodes.parentId),
              notInArray(agentKnowledgeNodes.id, startNodeIds),
              includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
            ),
          )
          .orderBy(asc(agentKnowledgeNodes.path))),
      );
    }

    return siblings.map((sibling) => ({
      ...sibling,
      relationship: 'sibling',
      depthFromStart: 1,
      childCount: 0,
    }));
  }

  static async #withChildCounts({
    identityId,
    nodes,
    includeInactive,
  }: {
    identityId: string;
    nodes: AgentKnowledgeExploreNode[];
    includeInactive: boolean;
  }) {
    if (nodes.length === 0) {
      return nodes;
    }

    const childCounts = await this.client
      .select({
        parentId: agentKnowledgeNodes.parentId,
        childCount: sql<number>`cast(count(*) as int)`,
      })
      .from(agentKnowledgeNodes)
      .where(
        and(
          eq(agentKnowledgeNodes.identityId, identityId),
          inArray(
            agentKnowledgeNodes.parentId,
            nodes.map((node) => node.id),
          ),
          includeInactive ? undefined : eq(agentKnowledgeNodes.active, true),
        ),
      )
      .groupBy(agentKnowledgeNodes.parentId);
    const childCountByParentId = new Map(
      childCounts.map((row) => [row.parentId, row.childCount] as const),
    );

    return nodes.map((node) => ({
      ...node,
      childCount: childCountByParentId.get(node.id) ?? 0,
    }));
  }

  static #setExploreNode(
    nodes: Map<string, AgentKnowledgeExploreNode>,
    node: AgentKnowledgeExploreNode,
  ) {
    const existingNode = nodes.get(node.id);

    if (
      !existingNode ||
      this.#exploreRelationshipPriority(node) > this.#exploreRelationshipPriority(existingNode)
    ) {
      nodes.set(node.id, node);
    }
  }

  static #exploreRelationshipPriority(node: AgentKnowledgeExploreNode) {
    const priority: Record<AgentKnowledgeExploreRelationship, number> = {
      start: 5,
      child: 4,
      descendant: 3,
      ancestor: 2,
      sibling: 1,
    };

    return priority[node.relationship];
  }

  static #compareExploreNodes(a: AgentKnowledgeExploreNode, b: AgentKnowledgeExploreNode) {
    const priorityDifference =
      this.#exploreRelationshipPriority(b) - this.#exploreRelationshipPriority(a);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const depthDifference = a.depthFromStart - b.depthFromStart;

    if (depthDifference !== 0) {
      return depthDifference;
    }

    if (a.path === b.path) {
      return 0;
    }

    return a.path < b.path ? -1 : 1;
  }
}

export type AgentKnowledgeContextRelationship = 'match' | 'ancestor' | 'child' | 'sibling';

export type AgentKnowledgeContextNode = AgentKnowledgeNode & {
  relationship: AgentKnowledgeContextRelationship;
  similarity?: number;
};

export type AgentKnowledgeExploreRelationship =
  | 'start'
  | 'ancestor'
  | 'child'
  | 'descendant'
  | 'sibling';

export type AgentKnowledgeExploreNode = AgentKnowledgeNode & {
  relationship: AgentKnowledgeExploreRelationship;
  depthFromStart: number;
  childCount: number;
};

type AgentKnowledgeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AgentKnowledgeMutationClient = Pick<AgentKnowledgeTransaction, 'insert' | 'select' | 'update'>;

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

type ReplaceKnowledgeNodeInput = {
  identityId: string;
  nodeId: string;
  replacement: Omit<CreateKnowledgeNodeInput, 'identityId'>;
};

type ReplaceKnowledgeNodeOutcome = {
  replacementNode: AgentKnowledgeNode;
  supersededNode: AgentKnowledgeNode;
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

type ListKnowledgeNodesInput = {
  identityId: string;
  parentPath?: string | null;
  includeInactive?: boolean;
  limit?: number;
};

type GetKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
  includeInactive?: boolean;
};

type SupersedeKnowledgeNodeInput = {
  identityId: string;
  nodeId: string;
  supersededById?: string;
};

type MoveKnowledgeNodeInput = {
  identityId: string;
  nodeId: string;
  parentId: string | null;
  slug?: string;
  title?: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
};

type GetRelevantContextNodesInput = {
  identityId: string;
  embedding: number[];
  matchLimit?: number;
  minSimilarity?: number;
  childLimit?: number;
  siblingLimit?: number;
};

type FindRelevantMatchesInput = {
  identityId: string;
  embedding: number[];
  limit?: number;
  minSimilarity?: number;
};

type ExploreKnowledgeNodesInput = {
  identityId: string;
  startNodeIds: string[];
  direction?: KnowledgeExploreDirection;
  maxDepth?: number;
  includeInactive?: boolean;
  limit?: number;
};

type KnowledgeExploreDirection =
  | 'auto'
  | 'children'
  | 'descendants'
  | 'ancestors'
  | 'siblings'
  | 'neighborhood';

export type AgentKnowledgeSimilarNode = AgentKnowledgeNode & {
  similarity: number;
};

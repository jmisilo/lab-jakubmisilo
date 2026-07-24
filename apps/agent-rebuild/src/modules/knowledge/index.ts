import { randomUUID } from 'node:crypto';

import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import {
  and,
  asc,
  cosineDistance,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import type { DatabaseTransaction } from '../../infrastructure/database/types';
import type {
  CreateKnowledgeNodeInput,
  ExploreKnowledgeInput,
  FindRelevantKnowledgeInput,
  KnowledgeContextItem,
  KnowledgeMatch,
  KnowledgeNode,
  MoveKnowledgeNodeInput,
  UpdateKnowledgeNodeInput,
} from './types';
import { database } from '../../infrastructure/database';
import { knowledgeNodeClosure, knowledgeNodes } from '../../infrastructure/database/schema';

const DEFAULT_MATCH_LIMIT = 5;
const DEFAULT_MINIMUM_SIMILARITY = 0.35;
const MAX_CONTEXT_ITEMS = 12;
const EMBEDDING_CONTENT_LIMIT = 4_000;

export class KnowledgeService {
  static async createNode(input: CreateKnowledgeNodeInput) {
    const path = this.#normalizePath(input.path);
    const pathParts = path.split('/');
    const paths = pathParts.map((_, index) => pathParts.slice(0, index + 1).join('/'));
    const existingNodes = await database
      .select({ path: knowledgeNodes.path })
      .from(knowledgeNodes)
      .where(
        and(
          eq(knowledgeNodes.identityId, input.identityId),
          inArray(knowledgeNodes.path, paths),
          eq(knowledgeNodes.active, true),
        ),
      );
    const existingPaths = new Set(existingNodes.map((node) => node.path));

    if (existingPaths.has(path)) {
      throw new Error(`Active knowledge already exists at "${path}".`);
    }

    const preparedNodes = await Promise.all(
      pathParts.map(async (slug, index) => {
        const nodePath = paths[index]!;
        const isTarget = index === pathParts.length - 1;
        const title = isTarget ? input.title.trim() : this.#titleFromSlug(slug);
        const content = isTarget ? input.content.trim() : `Knowledge group for ${title}.`;

        return {
          path: nodePath,
          slug,
          title,
          content,
          embedding: existingPaths.has(nodePath)
            ? undefined
            : await this.#createEmbedding({ title, content }),
        };
      }),
    );

    return database.transaction(async (transaction) => {
      let parentId: string | null = null;
      let createdNode: KnowledgeNode | undefined;

      for (const [index, preparedNode] of preparedNodes.entries()) {
        const [existingNode] = await transaction
          .select()
          .from(knowledgeNodes)
          .where(
            and(
              eq(knowledgeNodes.identityId, input.identityId),
              eq(knowledgeNodes.path, preparedNode.path),
              eq(knowledgeNodes.active, true),
            ),
          )
          .limit(1);
        const isTarget = index === preparedNodes.length - 1;

        if (existingNode) {
          if (isTarget) {
            throw new Error(`Active knowledge already exists at "${preparedNode.path}".`);
          }

          parentId = existingNode.id;
          continue;
        }

        if (!preparedNode.embedding) {
          throw new Error(
            `Knowledge tree changed while creating "${path}". Please retry the operation.`,
          );
        }

        const id = randomUUID();
        const [insertedNode] = await transaction
          .insert(knowledgeNodes)
          .values({
            id,
            identityId: input.identityId,
            parentId,
            path: preparedNode.path,
            slug: preparedNode.slug,
            title: preparedNode.title,
            content: preparedNode.content,
            embedding: preparedNode.embedding,
            source: isTarget ? (input.source ?? 'explicit') : 'agent',
            sourceMessageId: isTarget ? input.sourceMessageId : undefined,
            metadata: isTarget ? (input.metadata ?? {}) : { structural: true },
          })
          .returning();

        if (!insertedNode) {
          throw new Error(`Knowledge node "${preparedNode.path}" was not created.`);
        }

        const closureRows: (typeof knowledgeNodeClosure.$inferInsert)[] = [
          {
            identityId: input.identityId,
            ancestorId: id,
            descendantId: id,
            depth: 0,
          },
        ];

        if (parentId) {
          const parentAncestors = await transaction
            .select({
              ancestorId: knowledgeNodeClosure.ancestorId,
              depth: knowledgeNodeClosure.depth,
            })
            .from(knowledgeNodeClosure)
            .where(
              and(
                eq(knowledgeNodeClosure.identityId, input.identityId),
                eq(knowledgeNodeClosure.descendantId, parentId),
              ),
            );

          closureRows.push(
            ...parentAncestors.map((ancestor) => ({
              identityId: input.identityId,
              ancestorId: ancestor.ancestorId,
              descendantId: id,
              depth: ancestor.depth + 1,
            })),
          );
        }

        await transaction.insert(knowledgeNodeClosure).values(closureRows);
        parentId = id;

        if (isTarget) {
          createdNode = this.#toKnowledgeNode(insertedNode);
        }
      }

      if (!createdNode) {
        throw new Error(`Knowledge node "${path}" was not created.`);
      }

      return createdNode;
    });
  }

  static async updateNode({
    identityId,
    path: inputPath,
    title,
    content,
  }: UpdateKnowledgeNodeInput) {
    const path = this.#normalizePath(inputPath);
    const node = await this.getNode({ identityId, path });
    const nextTitle = title?.trim() || node.title;
    const nextContent = content.trim();
    const embedding = await this.#createEmbedding({
      title: nextTitle,
      content: nextContent,
    });
    const [updatedNode] = await database
      .update(knowledgeNodes)
      .set({
        title: nextTitle,
        content: nextContent,
        embedding,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeNodes.identityId, identityId),
          eq(knowledgeNodes.id, node.id),
          eq(knowledgeNodes.active, true),
        ),
      )
      .returning();

    if (!updatedNode) {
      throw new Error(`Knowledge node "${path}" was not updated.`);
    }

    return this.#toKnowledgeNode(updatedNode);
  }

  static async deactivateNode({
    identityId,
    path: inputPath,
  }: {
    identityId: string;
    path: string;
  }) {
    const path = this.#normalizePath(inputPath);

    return database.transaction(async (transaction) => {
      const [node] = await transaction
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.identityId, identityId),
            eq(knowledgeNodes.path, path),
            eq(knowledgeNodes.active, true),
          ),
        )
        .limit(1);

      if (!node) {
        throw new Error(`Active knowledge node "${path}" was not found.`);
      }

      const descendants = await transaction
        .select({ id: knowledgeNodeClosure.descendantId })
        .from(knowledgeNodeClosure)
        .where(
          and(
            eq(knowledgeNodeClosure.identityId, identityId),
            eq(knowledgeNodeClosure.ancestorId, node.id),
          ),
        );
      const nodeIds = descendants.map((item) => item.id);

      await transaction
        .update(knowledgeNodes)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(knowledgeNodes.identityId, identityId), inArray(knowledgeNodes.id, nodeIds)));
      await transaction
        .delete(knowledgeNodeClosure)
        .where(
          and(
            eq(knowledgeNodeClosure.identityId, identityId),
            or(
              inArray(knowledgeNodeClosure.ancestorId, nodeIds),
              inArray(knowledgeNodeClosure.descendantId, nodeIds),
            ),
          ),
        );

      return { path, deactivatedNodeCount: nodeIds.length };
    });
  }

  static async moveNode({
    identityId,
    path: inputPath,
    destinationPath: inputDestination,
  }: MoveKnowledgeNodeInput) {
    const path = this.#normalizePath(inputPath);
    const destinationPath = this.#normalizePath(inputDestination);

    if (destinationPath === path || destinationPath.startsWith(`${path}/`)) {
      throw new Error('A knowledge node cannot be moved into its own subtree.');
    }

    return database.transaction(async (transaction) => {
      const [node] = await transaction
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.identityId, identityId),
            eq(knowledgeNodes.path, path),
            eq(knowledgeNodes.active, true),
          ),
        )
        .limit(1);

      if (!node) {
        throw new Error(`Active knowledge node "${path}" was not found.`);
      }

      const destinationParentPath = this.#parentPath(destinationPath);
      const [destinationParent] = destinationParentPath
        ? await transaction
            .select()
            .from(knowledgeNodes)
            .where(
              and(
                eq(knowledgeNodes.identityId, identityId),
                eq(knowledgeNodes.path, destinationParentPath),
                eq(knowledgeNodes.active, true),
              ),
            )
            .limit(1)
        : [undefined];

      if (destinationParentPath && !destinationParent) {
        throw new Error(`Destination parent "${destinationParentPath}" was not found.`);
      }

      const subtree = await transaction
        .select({
          ...getTableColumns(knowledgeNodes),
          depthFromRoot: knowledgeNodeClosure.depth,
        })
        .from(knowledgeNodeClosure)
        .innerJoin(knowledgeNodes, eq(knowledgeNodeClosure.descendantId, knowledgeNodes.id))
        .where(
          and(
            eq(knowledgeNodeClosure.identityId, identityId),
            eq(knowledgeNodeClosure.ancestorId, node.id),
            eq(knowledgeNodes.active, true),
          ),
        )
        .orderBy(asc(knowledgeNodeClosure.depth));
      const subtreeIds = subtree.map((item) => item.id);
      const destinationPaths = subtree.map((item) =>
        item.id === node.id ? destinationPath : `${destinationPath}${item.path.slice(path.length)}`,
      );
      const conflicts = await transaction
        .select({ path: knowledgeNodes.path })
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.identityId, identityId),
            eq(knowledgeNodes.active, true),
            inArray(knowledgeNodes.path, destinationPaths),
            notInArray(knowledgeNodes.id, subtreeIds),
          ),
        );

      if (conflicts.length > 0) {
        throw new Error(`Active knowledge already exists at "${conflicts[0]?.path}".`);
      }

      for (const subtreeNode of subtree) {
        const nextPath =
          subtreeNode.id === node.id
            ? destinationPath
            : `${destinationPath}${subtreeNode.path.slice(path.length)}`;

        await transaction
          .update(knowledgeNodes)
          .set({
            path: nextPath,
            slug: nextPath.split('/').at(-1),
            parentId:
              subtreeNode.id === node.id ? (destinationParent?.id ?? null) : subtreeNode.parentId,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeNodes.id, subtreeNode.id));
      }

      await this.#rebuildClosure({ identityId, transaction });

      return {
        previousPath: path,
        path: destinationPath,
        movedNodeCount: subtreeIds.length,
      };
    });
  }

  static async getNode({ identityId, path: inputPath }: { identityId: string; path: string }) {
    const path = this.#normalizePath(inputPath);
    const [node] = await database
      .select()
      .from(knowledgeNodes)
      .where(
        and(
          eq(knowledgeNodes.identityId, identityId),
          eq(knowledgeNodes.path, path),
          eq(knowledgeNodes.active, true),
        ),
      )
      .limit(1);

    if (!node) {
      throw new Error(`Active knowledge node "${path}" was not found.`);
    }

    return this.#toKnowledgeNode(node);
  }

  static async listChildren({
    identityId,
    parentPath,
  }: {
    identityId: string;
    parentPath?: string;
  }) {
    let parentId: string | null = null;

    if (parentPath) {
      parentId = (await this.getNode({ identityId, path: parentPath })).id;
    }

    const nodes = await database
      .select()
      .from(knowledgeNodes)
      .where(
        and(
          eq(knowledgeNodes.identityId, identityId),
          parentId ? eq(knowledgeNodes.parentId, parentId) : isNull(knowledgeNodes.parentId),
          eq(knowledgeNodes.active, true),
        ),
      )
      .orderBy(asc(knowledgeNodes.path));

    return nodes.map((node) => this.#toKnowledgeNode(node));
  }

  static async findRelevantNodes({
    identityId,
    query,
    limit = DEFAULT_MATCH_LIMIT,
    minimumSimilarity = DEFAULT_MINIMUM_SIMILARITY,
  }: FindRelevantKnowledgeInput): Promise<KnowledgeMatch[]> {
    const embedding = await this.#createEmbedding({ title: query, content: '' });
    const distance = cosineDistance(knowledgeNodes.embedding, embedding);
    const nodes = await database
      .select({
        ...getTableColumns(knowledgeNodes),
        similarity: sql<number>`1 - (${distance})`,
      })
      .from(knowledgeNodes)
      .where(
        and(
          eq(knowledgeNodes.identityId, identityId),
          eq(knowledgeNodes.active, true),
          lt(distance, 1 - minimumSimilarity),
        ),
      )
      .orderBy(asc(distance))
      .limit(limit);

    return nodes.map((node) => ({
      ...this.#toKnowledgeNode(node),
      similarity: Number(node.similarity),
    }));
  }

  static async retrieveContext(input: FindRelevantKnowledgeInput) {
    const matches = await this.findRelevantNodes(input);

    if (matches.length === 0) {
      return [];
    }

    const matchIds = matches.map((match) => match.id);
    const [ancestors, children] = await Promise.all([
      database
        .select(getTableColumns(knowledgeNodes))
        .from(knowledgeNodeClosure)
        .innerJoin(knowledgeNodes, eq(knowledgeNodeClosure.ancestorId, knowledgeNodes.id))
        .where(
          and(
            eq(knowledgeNodeClosure.identityId, input.identityId),
            inArray(knowledgeNodeClosure.descendantId, matchIds),
            sql`${knowledgeNodeClosure.depth} > 0`,
            eq(knowledgeNodes.active, true),
          ),
        )
        .orderBy(asc(knowledgeNodeClosure.depth)),
      database
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.identityId, input.identityId),
            inArray(knowledgeNodes.parentId, matchIds),
            eq(knowledgeNodes.active, true),
          ),
        )
        .orderBy(asc(knowledgeNodes.path)),
    ]);
    const context = new Map<string, KnowledgeContextItem>();

    for (const match of matches) {
      context.set(match.id, { ...match, relationship: 'match' });
    }

    for (const ancestor of ancestors) {
      if (!context.has(ancestor.id)) {
        context.set(ancestor.id, {
          ...this.#toKnowledgeNode(ancestor),
          relationship: 'ancestor',
        });
      }
    }

    for (const child of children) {
      if (!context.has(child.id)) {
        context.set(child.id, {
          ...this.#toKnowledgeNode(child),
          relationship: 'child',
        });
      }
    }

    return [...context.values()].slice(0, MAX_CONTEXT_ITEMS);
  }

  static async explore({ identityId, path, direction, depth }: ExploreKnowledgeInput) {
    const node = await this.getNode({ identityId, path });
    const results = new Map<string, KnowledgeNode>([[node.id, node]]);

    if (direction === 'ancestors' || direction === 'both') {
      const ancestors = await database
        .select(getTableColumns(knowledgeNodes))
        .from(knowledgeNodeClosure)
        .innerJoin(knowledgeNodes, eq(knowledgeNodeClosure.ancestorId, knowledgeNodes.id))
        .where(
          and(
            eq(knowledgeNodeClosure.identityId, identityId),
            eq(knowledgeNodeClosure.descendantId, node.id),
            sql`${knowledgeNodeClosure.depth} between 1 and ${depth}`,
            eq(knowledgeNodes.active, true),
          ),
        );

      for (const ancestor of ancestors) {
        results.set(ancestor.id, this.#toKnowledgeNode(ancestor));
      }
    }

    if (direction === 'children') {
      const children = await this.listChildren({ identityId, parentPath: path });

      for (const child of children) {
        results.set(child.id, child);
      }
    }

    if (direction === 'descendants' || direction === 'both') {
      const descendants = await database
        .select(getTableColumns(knowledgeNodes))
        .from(knowledgeNodeClosure)
        .innerJoin(knowledgeNodes, eq(knowledgeNodeClosure.descendantId, knowledgeNodes.id))
        .where(
          and(
            eq(knowledgeNodeClosure.identityId, identityId),
            eq(knowledgeNodeClosure.ancestorId, node.id),
            sql`${knowledgeNodeClosure.depth} between 1 and ${depth}`,
            eq(knowledgeNodes.active, true),
          ),
        );

      for (const descendant of descendants) {
        results.set(descendant.id, this.#toKnowledgeNode(descendant));
      }
    }

    return [...results.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  static async #createEmbedding({ title, content }: { title: string; content: string }) {
    const value = `${title}\n\n${content.slice(0, EMBEDDING_CONTENT_LIMIT)}`;
    const result = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value,
    });

    return result.embedding;
  }

  static async #rebuildClosure({
    identityId,
    transaction,
  }: {
    identityId: string;
    transaction: DatabaseTransaction;
  }) {
    await transaction
      .delete(knowledgeNodeClosure)
      .where(eq(knowledgeNodeClosure.identityId, identityId));
    await transaction.execute(sql`
      with recursive ancestry as (
        select
          ${knowledgeNodes.identityId} as identity_id,
          ${knowledgeNodes.id} as ancestor_id,
          ${knowledgeNodes.id} as descendant_id,
          0 as depth
        from ${knowledgeNodes}
        where ${knowledgeNodes.identityId} = ${identityId}
          and ${knowledgeNodes.active} = true

        union all

        select
          ancestry.identity_id,
          parent.id as ancestor_id,
          ancestry.descendant_id,
          ancestry.depth + 1
        from ancestry
        join ${knowledgeNodes} child on child.id = ancestry.ancestor_id
        join ${knowledgeNodes} parent on parent.id = child.parent_id
        where parent.active = true
      )
      insert into ${knowledgeNodeClosure} (
        identity_id,
        ancestor_id,
        descendant_id,
        depth
      )
      select identity_id, ancestor_id, descendant_id, depth
      from ancestry
    `);
  }

  static #normalizePath(path: string) {
    const normalized = path
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .map((part) =>
        part
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
      .filter(Boolean)
      .join('/');

    if (!normalized || normalized.length > 500) {
      throw new Error('Knowledge path must contain a valid slash-separated path.');
    }

    return normalized;
  }

  static #parentPath(path: string) {
    const parts = path.split('/');

    return parts.length > 1 ? parts.slice(0, -1).join('/') : undefined;
  }

  static #titleFromSlug(slug: string) {
    return slug
      .split('-')
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  static #toKnowledgeNode(node: typeof knowledgeNodes.$inferSelect): KnowledgeNode {
    return {
      id: node.id,
      identityId: node.identityId,
      parentId: node.parentId,
      path: node.path,
      slug: node.slug,
      title: node.title,
      content: node.content,
      active: node.active,
      supersededById: node.supersededById,
      source: node.source,
      sourceMessageId: node.sourceMessageId,
      metadata: node.metadata,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }
}

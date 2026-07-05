import type { ShortTermMemory } from '@/app/memory/types';
import type { AgentKnowledgeSource } from '@/types';

import { createHash } from 'node:crypto';

import dedent from 'dedent';

import { ImplicitKnowledgeExtractionSchema } from '@/app/knowledge/schemas';
import { AIService } from '@/infrastructure/ai';
import { AgentKnowledgeDbService } from '@/infrastructure/db/services/agent-knowledge';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

type CreateKnowledgeNodeInput = {
  identityId: string;
  parentId?: string | null;
  parentPath?: string | null;
  slug?: string;
  title: string;
  content?: string;
  source?: AgentKnowledgeSource;
  sourceMessageId?: string;
  metadata?: Record<string, unknown>;
};

type UpdateKnowledgeNodeContentInput = {
  identityId: string;
  nodeId: string;
  title?: string;
  content: string;
};

type UpdateKnowledgeNodeByPathInput = Omit<UpdateKnowledgeNodeContentInput, 'nodeId'> & {
  path: string;
};

type SupersedeKnowledgeNodeInput = {
  identityId: string;
  nodeId: string;
  supersededById?: string;
};

type SupersedeKnowledgeNodeByPathInput = {
  identityId: string;
  path: string;
  supersededByPath?: string;
};

type GetContextItemsInput = {
  identityId: string;
  shortTermMemory: ShortTermMemory[];
};

type ExtractImplicitKnowledgeInput = {
  identityId: string;
  threadId: string;
  sourceMessageId: string;
  userMessage: string;
  assistantMessage: string;
};

export class AgentKnowledgeService {
  static readonly contextRetrievalMessageLimit = 8;
  static readonly contextMatchLimit = 3;
  static readonly contextMinSimilarity = 0.35;
  static readonly contextChildLimit = 8;
  static readonly contextSiblingLimit = 8;
  static readonly contextItemContentCharacterLimit = 2_000;
  static readonly implicitExtractionMinConfidence = 0.72;
  static readonly implicitExtractionItemLimit = 3;

  static async createNode(input: CreateKnowledgeNodeInput) {
    const parentId = await this.#resolveParentId(input);
    const title = this.#normalizeRequiredText({
      value: input.title,
      field: 'title',
    });
    const content = input.content?.trim() ?? '';

    return this.#createEmbeddedNode({
      identityId: input.identityId,
      parentId,
      slug: input.slug,
      title,
      content,
      source: input.source,
      sourceMessageId: input.sourceMessageId,
      metadata: input.metadata,
    });
  }

  static async updateNodeByPath({ identityId, path, ...input }: UpdateKnowledgeNodeByPathInput) {
    const node = await AgentKnowledgeDbService.getActiveNodeByPath({
      identityId,
      path: this.#normalizePath(path),
    });

    return this.updateNodeContent({
      ...input,
      identityId,
      nodeId: node.id,
    });
  }

  static async updateNodeContent(input: UpdateKnowledgeNodeContentInput) {
    const title =
      input.title !== undefined
        ? this.#normalizeRequiredText({ value: input.title, field: 'title' })
        : undefined;
    const content = input.content.trim();
    let embeddingTitle = title;

    if (!embeddingTitle) {
      const currentNode = await AgentKnowledgeDbService.getNode({
        identityId: input.identityId,
        nodeId: input.nodeId,
      });

      embeddingTitle = currentNode.title;
    }

    const embeddingText = this.#createEmbeddingText({
      title: embeddingTitle,
      content,
    });
    const embedding = await AIService.embed(embeddingText);

    return AgentKnowledgeDbService.updateNodeContent({
      ...input,
      title,
      content,
      embedding,
      embeddingModel: AIService.embeddingModel,
      embeddingContentHash: this.#hashText(embeddingText),
    });
  }

  static async supersedeNode(input: SupersedeKnowledgeNodeInput) {
    return AgentKnowledgeDbService.supersedeNode(input);
  }

  static async supersedeNodeByPath({
    identityId,
    path,
    supersededByPath,
  }: SupersedeKnowledgeNodeByPathInput) {
    const [node, supersededByNode] = await Promise.all([
      AgentKnowledgeDbService.getActiveNodeByPath({
        identityId,
        path: this.#normalizePath(path),
      }),
      supersededByPath
        ? AgentKnowledgeDbService.getActiveNodeByPath({
            identityId,
            path: this.#normalizePath(supersededByPath),
          })
        : Promise.resolve(null),
    ]);

    return AgentKnowledgeDbService.supersedeNode({
      identityId,
      nodeId: node.id,
      supersededById: supersededByNode?.id,
    });
  }

  static async getContextItems({ identityId, shortTermMemory }: GetContextItemsInput) {
    const retrievalText = this.#createRetrievalText(shortTermMemory);

    if (!retrievalText) {
      return [];
    }

    try {
      const embedding = await AIService.embed(retrievalText);
      const nodes = await AgentKnowledgeDbService.getRelevantContextNodes({
        identityId,
        embedding,
        matchLimit: this.contextMatchLimit,
        minSimilarity: this.contextMinSimilarity,
        childLimit: this.contextChildLimit,
        siblingLimit: this.contextSiblingLimit,
      });

      logger.info(
        {
          identityId,
          retrievedKnowledgeNodeCount: nodes.length,
        },
        '[AGENT_KNOWLEDGE]: context retrieved',
      );

      return nodes.map((node) => this.#formatContextNode(node));
    } catch (error) {
      logger.warn(
        {
          identityId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_KNOWLEDGE]: context retrieval failed',
      );

      return [];
    }
  }

  static async extractImplicitKnowledge({
    identityId,
    threadId,
    sourceMessageId,
    userMessage,
    assistantMessage,
  }: ExtractImplicitKnowledgeInput) {
    try {
      const extractionText = await AIService.generate({
        timeoutMs: 20_000,
        messages: [
          {
            role: 'user',
            content: dedent`
              Extract durable user-scoped knowledge from this just-finished conversation turn.

              Current date: ${new Date().toISOString().slice(0, 10)}

              Return strict JSON with this shape:
              {"items":[{"title":"...","content":"...","confidence":0.0,"reason":"...","slug":"optional","parentPath":"optional"}]}

              Rules:
              - Extract only durable facts, preferences, defaults, decisions, project facts, or useful history.
              - Use this ingestion frequently for important user information, especially nationality, age, gender, home/native/default location, language, work, relationships, durable preferences, and project context.
              - It is allowed to extract sensitive personal information when the user states it.
              - Infer obvious durable facts when useful. Example: if the user says they are 25 in July 2026, content may note approximate birth year 2000 or 2001.
              - If the user explicitly asked to remember/save/note/update something, return {"items":[]} because the manage-knowledge tool handles explicit writes.
              - Do not extract transient task details, jokes, or one-off requests.
              - Prefer root-level notes unless an existing parent path is clearly known from the conversation.
              - Use concise markdown content. Include uncertainty when inferred.
              - Return at most ${this.implicitExtractionItemLimit} items.

              User message:
              ${userMessage}

              Assistant response:
              ${assistantMessage}
            `,
          },
        ],
      });
      const parsed = ImplicitKnowledgeExtractionSchema.safeParse(
        this.#parseJsonObject(extractionText),
      );

      if (!parsed.success) {
        logger.warn(
          {
            identityId,
            threadId,
            sourceMessageId,
            issues: parsed.error.issues,
          },
          '[AGENT_KNOWLEDGE]: implicit extraction invalid',
        );

        return;
      }

      const items = parsed.data.items
        .filter((item) => item.confidence >= this.implicitExtractionMinConfidence)
        .slice(0, this.implicitExtractionItemLimit);

      if (items.length === 0) {
        logger.debug(
          { identityId, threadId, sourceMessageId },
          '[AGENT_KNOWLEDGE]: implicit extraction skipped',
        );

        return;
      }

      const createdNodes = await Promise.all(
        items.map((item) =>
          this.createNode({
            identityId,
            parentPath: item.parentPath,
            slug: item.slug,
            title: item.title,
            content: item.content,
            source: 'implicit',
            sourceMessageId,
            metadata: {
              extractionReason: item.reason,
              confidence: item.confidence,
              threadId,
            },
          }),
        ),
      );

      logger.info(
        {
          identityId,
          threadId,
          sourceMessageId,
          createdKnowledgeNodeCount: createdNodes.length,
        },
        '[AGENT_KNOWLEDGE]: implicit knowledge extracted',
      );
    } catch (error) {
      logger.error(
        {
          identityId,
          threadId,
          sourceMessageId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_KNOWLEDGE]: implicit extraction failed',
      );
    }
  }

  static #createRetrievalText(shortTermMemory: ShortTermMemory[]) {
    const recentMessages = shortTermMemory.slice(-this.contextRetrievalMessageLimit);
    const hasUserText = recentMessages.some(
      (message) => message.role === 'user' && message.text.trim(),
    );

    if (!hasUserText) {
      return null;
    }

    const retrievalText = recentMessages
      .map((message) => `${message.role}: ${message.text.trim()}`)
      .filter((message) => message.trim())
      .join('\n')
      .trim();

    return retrievalText || null;
  }

  static #formatContextNode(
    node: Awaited<ReturnType<typeof AgentKnowledgeDbService.getRelevantContextNodes>>[number],
  ) {
    const similarity =
      node.relationship === 'match' && typeof node.similarity === 'number'
        ? ` similarity=${node.similarity.toFixed(3)}`
        : '';
    const content = this.#truncateContent(node.content.trim() || '(empty)');

    return dedent`
      - [knowledge:${node.relationship}${similarity}] ${node.path}
        Title: ${node.title}
        Content:
        ${content}
    `;
  }

  static #createEmbeddingText({ title, content }: { title: string; content: string }) {
    return dedent`
      Title: ${title}

      Content:
      ${content || '(empty)'}
    `;
  }

  static #normalizeRequiredText({ value, field }: { value: string; field: string }) {
    const normalized = value.trim();

    if (!normalized) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Knowledge node input is invalid.',
        context: { field },
        retryable: false,
      });
    }

    return normalized;
  }

  static #normalizePath(path: string) {
    return path
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/');
  }

  static async #createEmbeddedNode({
    identityId,
    parentId,
    slug,
    title,
    content,
    source,
    sourceMessageId,
    metadata,
  }: {
    identityId: string;
    parentId?: string | null;
    slug?: string;
    title: string;
    content: string;
    source?: AgentKnowledgeSource;
    sourceMessageId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const embeddingText = this.#createEmbeddingText({ title, content });
    const embedding = await AIService.embed(embeddingText);

    return AgentKnowledgeDbService.createNode({
      identityId,
      parentId,
      slug,
      title,
      content,
      source,
      sourceMessageId,
      metadata,
      embedding,
      embeddingModel: AIService.embeddingModel,
      embeddingContentHash: this.#hashText(embeddingText),
    });
  }

  static async #resolveParentId(input: CreateKnowledgeNodeInput) {
    if (input.parentId) {
      return input.parentId;
    }

    const normalizedParentPath = input.parentPath ? this.#normalizePath(input.parentPath) : null;

    if (!normalizedParentPath) {
      return null;
    }

    const parent = await this.#ensureParentPath({
      identityId: input.identityId,
      path: normalizedParentPath,
      sourceMessageId: input.sourceMessageId,
    });

    return parent.id;
  }

  static async #ensureParentPath({
    identityId,
    path,
    sourceMessageId,
  }: {
    identityId: string;
    path: string;
    sourceMessageId?: string;
  }) {
    let parentId: string | null = null;
    let ensuredNode: Awaited<ReturnType<typeof AgentKnowledgeDbService.findActiveNodeByPath>> =
      null;
    const pathSegments = path.split('/').filter(Boolean);

    for (const pathSegment of pathSegments) {
      const currentPath = ensuredNode ? `${ensuredNode.path}/${pathSegment}` : pathSegment;
      const existingNode = await AgentKnowledgeDbService.findActiveNodeByPath({
        identityId,
        path: currentPath,
      });

      if (existingNode) {
        parentId = existingNode.id;
        ensuredNode = existingNode;
        continue;
      }

      const title = this.#titleFromSlug(pathSegment);
      const content = `Knowledge group for ${currentPath}.`;
      const createdNode = await this.#createEmbeddedNode({
        identityId,
        parentId,
        slug: pathSegment,
        title,
        content,
        source: 'system',
        sourceMessageId,
        metadata: {
          autoCreated: true,
          autoCreatedReason: 'missing_parent_path',
          path: currentPath,
        },
      });

      if (!createdNode) {
        throw new AppError({
          code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
          message: 'Knowledge parent path segment was not created.',
          context: { identityId, path: currentPath },
          retryable: true,
        });
      }

      logger.info(
        {
          identityId,
          sourceMessageId,
          path: createdNode.path,
          nodeId: createdNode.id,
        },
        '[AGENT_KNOWLEDGE]: parent node auto-created',
      );

      parentId = createdNode.id;
      ensuredNode = createdNode;
    }

    if (!ensuredNode) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
        message: 'Knowledge parent path could not be ensured.',
        context: { identityId, path },
        retryable: false,
      });
    }

    return ensuredNode;
  }

  static #titleFromSlug(slug: string) {
    return slug
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  static #truncateContent(content: string) {
    if (content.length <= this.contextItemContentCharacterLimit) {
      return content;
    }

    return `${content.slice(0, this.contextItemContentCharacterLimit)}\n[truncated]`;
  }

  static #hashText(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  static #parseJsonObject(value: string) {
    const trimmedValue = value.trim();
    const withoutFence = trimmedValue
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');

    if (start === -1 || end === -1 || end < start) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Implicit knowledge extraction did not return JSON.',
        context: { outputLength: value.length },
        retryable: false,
      });
    }

    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
  }
}

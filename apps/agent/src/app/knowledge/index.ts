import type {
  CreateKnowledgeNodeInput,
  DeactivateKnowledgeNodeByPathInput,
  ExploreKnowledgeNodesInput,
  ExtractImplicitKnowledgeInput,
  GetContextItemsInput,
  ImplicitKnowledgeIngestionAction,
  ImplicitKnowledgeIngestionDecision,
  ImplicitKnowledgeIngestionOutcome,
  ImplicitKnowledgeItem,
  ListKnowledgeNodesInput,
  MoveKnowledgeNodeByPathInput,
  ReadKnowledgeNodeByPathInput,
  SupersedeKnowledgeNodeByPathInput,
  SupersedeKnowledgeNodeInput,
  UpdateKnowledgeNodeByPathInput,
  UpdateKnowledgeNodeContentInput,
} from '@/app/knowledge/types';
import type { ShortTermMemory } from '@/app/memory/types';
import type {
  AgentKnowledgeExploreNode,
  AgentKnowledgeSimilarNode,
} from '@/infrastructure/db/services/agent-knowledge';
import type { AgentKnowledgeSource } from '@/types';

import { createHash } from 'node:crypto';

import { Output } from 'ai';
import dedent from 'dedent';

import {
  ImplicitKnowledgeExtractionModelOutputSchema,
  ImplicitKnowledgeExtractionSchema,
  ImplicitKnowledgeIngestionDecisionModelOutputSchema,
  ImplicitKnowledgeIngestionDecisionSchema,
  KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS,
  KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS,
} from '@/app/knowledge/schemas';
import { AIService } from '@/infrastructure/ai';
import { AgentKnowledgeDbService } from '@/infrastructure/db/services/agent-knowledge';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export class AgentKnowledgeService {
  static readonly contextRetrievalMessageLimit = 8;
  static readonly contextMatchLimit = 5;
  static readonly contextMinSimilarity = 0.35;
  static readonly contextChildLimit = 8;
  static readonly contextSiblingLimit = 8;
  static readonly nodeTitleCharacterLimit = KNOWLEDGE_NODE_TITLE_MAX_CHARACTERS;
  static readonly nodeContentCharacterLimit = KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS;
  static readonly embeddingContentCharacterLimit = 4_000;
  static readonly implicitExtractionMinConfidence = 0.72;
  static readonly implicitExtractionItemLimit = 3;
  static readonly implicitExtractionPathHintLimit = 8;
  static readonly implicitExtractionPathHintMinSimilarity = 0.35;
  static readonly implicitExtractionPathHintContentCharacterLimit = 500;
  static readonly implicitIngestionCandidateContentCharacterLimit = 2_000;
  static readonly implicitMergeCandidateLimit = 5;
  static readonly implicitMergeMinSimilarity = 0.35;
  static readonly exploreDefaultLimit = 12;
  static readonly exploreMaxLimit = 30;
  static readonly exploreDefaultMaxDepth = 2;
  static readonly exploreMaxDepth = 5;
  static readonly exploreQuerySeedLimit = 3;
  static readonly exploreQueryMinSimilarity = 0.35;
  static readonly exploreCandidateFetchLimit = 80;

  static async createNode(input: CreateKnowledgeNodeInput) {
    const parentId = await this.#resolveParentId(input);
    const title = this.#normalizeTitle({
      value: input.title,
    });
    const content = input.content ? this.#normalizeContent(input.content) : '';

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

  static async listNodes({
    identityId,
    parentPath,
    includeInactive,
    limit,
  }: ListKnowledgeNodesInput) {
    return AgentKnowledgeDbService.listNodes({
      identityId,
      parentPath: parentPath ? this.#normalizePath(parentPath) : null,
      includeInactive,
      limit: Math.min(Math.max(limit ?? 50, 1), 50),
    });
  }

  static async readNodeByPath({ identityId, path, includeInactive }: ReadKnowledgeNodeByPathInput) {
    return AgentKnowledgeDbService.getNodeByPath({
      identityId,
      path: this.#normalizePath(path),
      includeInactive,
    });
  }

  static async exploreNodes({
    identityId,
    startPath,
    query,
    direction,
    maxDepth,
    includeInactive,
    limit,
  }: ExploreKnowledgeNodesInput) {
    const normalizedStartPath = startPath ? this.#normalizePath(startPath) : undefined;
    const normalizedQuery = query?.trim();

    if (!normalizedStartPath && !normalizedQuery) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Knowledge exploration requires a start path or query.',
        context: { identityId },
        retryable: false,
      });
    }

    const selectedLimit = this.#clampNumber({
      value: limit ?? this.exploreDefaultLimit,
      min: 1,
      max: this.exploreMaxLimit,
    });
    const selectedMaxDepth = this.#clampNumber({
      value: maxDepth ?? this.exploreDefaultMaxDepth,
      min: 0,
      max: this.exploreMaxDepth,
    });
    const queryEmbedding = normalizedQuery ? await AIService.embed(normalizedQuery) : undefined;
    const startNodeIds = await this.#resolveExploreStartNodeIds({
      identityId,
      startPath: normalizedStartPath,
      queryEmbedding,
      includeInactive,
    });

    if (startNodeIds.length === 0) {
      return {
        nodes: [],
        truncated: false,
        startPaths: [],
        suggestedNextPaths: [],
      };
    }

    const candidates = await AgentKnowledgeDbService.exploreNodes({
      identityId,
      startNodeIds,
      direction,
      maxDepth: selectedMaxDepth,
      includeInactive,
      limit: this.exploreCandidateFetchLimit,
    });
    const rankedNodes = this.#rankExploreNodes({
      nodes: candidates,
      query: normalizedQuery,
      queryEmbedding,
    });
    const selectedNodes = rankedNodes.slice(0, selectedLimit);

    return {
      nodes: selectedNodes,
      truncated: rankedNodes.length > selectedLimit,
      startPaths: rankedNodes
        .filter((node) => node.relationship === 'start')
        .map((node) => node.path),
      suggestedNextPaths: this.#getSuggestedExploreNextPaths(selectedNodes),
    };
  }

  static async deactivateNodeByPath({ identityId, path }: DeactivateKnowledgeNodeByPathInput) {
    const node = await AgentKnowledgeDbService.getActiveNodeByPath({
      identityId,
      path: this.#normalizePath(path),
    });

    return AgentKnowledgeDbService.supersedeNode({
      identityId,
      nodeId: node.id,
    });
  }

  static async moveNodeByPath({
    identityId,
    path,
    newParentPath,
    newSlug,
    title,
  }: MoveKnowledgeNodeByPathInput) {
    const node = await AgentKnowledgeDbService.getActiveNodeByPath({
      identityId,
      path: this.#normalizePath(path),
    });
    const normalizedTitle =
      title !== undefined ? this.#normalizeTitle({ value: title }) : undefined;
    const parentId =
      newParentPath === undefined
        ? node.parentId
        : await this.#resolveMoveParentId({
            identityId,
            newParentPath,
          });
    let embedding: number[] | undefined;
    let embeddingContentHash: string | undefined;
    let embeddingModel: string | undefined;

    if (normalizedTitle !== undefined) {
      const embeddingFields = await this.#createEmbeddingFields({
        identityId,
        operation: 'knowledge.move',
        title: normalizedTitle,
        content: node.content,
      });

      embedding = embeddingFields.embedding;
      embeddingModel = embeddingFields.embeddingModel;
      embeddingContentHash = embeddingFields.embeddingContentHash;
    }

    return AgentKnowledgeDbService.moveNode({
      identityId,
      nodeId: node.id,
      parentId,
      slug: newSlug,
      title: normalizedTitle,
      embedding,
      embeddingModel,
      embeddingContentHash,
    });
  }

  static async updateNodeContent(input: UpdateKnowledgeNodeContentInput) {
    const title =
      input.title !== undefined ? this.#normalizeTitle({ value: input.title }) : undefined;
    const content = this.#normalizeContent(input.content);
    let embeddingTitle = title;

    if (!embeddingTitle) {
      const currentNode = await AgentKnowledgeDbService.getNode({
        identityId: input.identityId,
        nodeId: input.nodeId,
      });

      embeddingTitle = currentNode.title;
    }

    const embeddingFields = await this.#createEmbeddingFields({
      identityId: input.identityId,
      operation: 'knowledge.update',
      title: embeddingTitle,
      content,
    });

    return AgentKnowledgeDbService.updateNodeContent({
      ...input,
      title,
      content,
      ...embeddingFields,
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
      const pathHints = await this.#getImplicitExtractionPathHints({
        identityId,
        threadId,
        sourceMessageId,
        userMessage,
        assistantMessage,
      });
      const extractionResult = await AIService.generate({
        reasoning: 'high',
        output: Output.object({
          schema: ImplicitKnowledgeExtractionModelOutputSchema,
          name: 'implicit_knowledge_extraction',
          description: 'Durable knowledge items extracted from the latest conversation turn.',
        }),
        messages: [
          {
            role: 'user',
            content: dedent`
              Extract durable user-scoped knowledge from this just-finished conversation turn.

              Current date: ${new Date().toISOString().slice(0, 10)}

              Return an object with this shape:
              {"items":[{"title":"...","content":"...","confidence":0.0,"reason":"... or null","slug":"... or null","parentPath":"... or null"}]}

              Rules:
              - Extract only durable facts, preferences, defaults, decisions, project facts, or useful history.
              - Use this ingestion frequently for important user information, especially nationality, age, gender, home/native/default location, language, work, relationships, durable preferences, and project context.
              - It is allowed to extract sensitive personal information when the user states it.
              - Infer obvious durable facts when useful. Example: if the user says they are 25 in July 2026, content may note approximate birth year 2000 or 2001.
              - If the user explicitly asked to remember/save/note/update something, return {"items":[]} because the manage-knowledge tool handles explicit writes.
              - Use null for optional fields that do not apply.
              - Do not extract transient task details, jokes, or one-off requests.
              - Prefer a relevant existing parent path from # Existing Knowledge Path Hints when it clearly fits.
              - Create specific child notes under the best matching profile, preference, work, project, idea, or journal path instead of broad root-level notes.
              - Use root-level notes only when no existing path hint fits and no natural parent is obvious.
              - Use concise markdown content. Include uncertainty when inferred.
              - Return at most ${this.implicitExtractionItemLimit} items.

              # Existing Knowledge Path Hints

              These are active notes likely related to the latest turn. Use their paths only when they clearly fit the new item.

              ${this.#formatImplicitExtractionPathHints(pathHints)}

              User message:
              ${userMessage}

              Assistant response:
              ${assistantMessage}
            `,
          },
        ],
      });
      const parsed = ImplicitKnowledgeExtractionSchema.safeParse(extractionResult.output);

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

      const outcomes: ImplicitKnowledgeIngestionOutcome[] = [];

      for (const item of items) {
        try {
          outcomes.push(
            await this.#ingestImplicitKnowledgeItem({
              identityId,
              threadId,
              sourceMessageId,
              item,
            }),
          );
        } catch (itemError) {
          logger.warn(
            {
              identityId,
              threadId,
              sourceMessageId,
              itemTitle: item.title,
              error: itemError,
              safeError: ErrorService.toSafeLog(itemError),
            },
            '[AGENT_KNOWLEDGE]: implicit item ingestion failed',
          );
        }
      }

      const outcomeCounts = this.#countImplicitIngestionOutcomes(outcomes);

      logger.info(
        {
          identityId,
          threadId,
          sourceMessageId,
          ingestedKnowledgeItemCount: outcomes.length,
          createdKnowledgeNodeCount: outcomeCounts.create,
          updatedKnowledgeNodeCount: outcomeCounts.update,
          supersededKnowledgeNodeCount: outcomeCounts.supersede,
          skippedKnowledgeItemCount: outcomeCounts.skip,
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

  static async #getImplicitExtractionPathHints({
    identityId,
    threadId,
    sourceMessageId,
    userMessage,
    assistantMessage,
  }: {
    identityId: string;
    threadId: string;
    sourceMessageId: string;
    userMessage: string;
    assistantMessage: string;
  }) {
    const retrievalText = dedent`
      User message:
      ${userMessage.trim()}

      Assistant response:
      ${assistantMessage.trim()}
    `.trim();

    if (!retrievalText) {
      return [];
    }

    try {
      const embedding = await AIService.embed(retrievalText);
      const matches = await AgentKnowledgeDbService.findRelevantMatches({
        identityId,
        embedding,
        limit: this.implicitExtractionPathHintLimit,
        minSimilarity: this.implicitExtractionPathHintMinSimilarity,
      });

      return matches ?? [];
    } catch (error) {
      logger.warn(
        {
          identityId,
          threadId,
          sourceMessageId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_KNOWLEDGE]: implicit extraction path hints failed',
      );

      return [];
    }
  }

  static async #ingestImplicitKnowledgeItem({
    identityId,
    threadId,
    sourceMessageId,
    item,
  }: {
    identityId: string;
    threadId: string;
    sourceMessageId: string;
    item: ImplicitKnowledgeItem;
  }): Promise<ImplicitKnowledgeIngestionOutcome> {
    const candidates = await this.#findImplicitKnowledgeCandidates({ identityId, item });
    const decision = await this.#decideImplicitKnowledgeIngestion({
      identityId,
      sourceMessageId,
      item,
      candidates,
    });

    logger.info(
      {
        identityId,
        threadId,
        sourceMessageId,
        action: decision.action,
        targetPath: decision.targetPath,
        candidateCount: candidates.length,
        candidatePaths: candidates.map((candidate) => candidate.path),
        reason: decision.reason,
      },
      '[AGENT_KNOWLEDGE]: implicit ingestion decision',
    );

    return this.#applyImplicitKnowledgeIngestionDecision({
      identityId,
      threadId,
      sourceMessageId,
      item,
      candidates,
      decision,
    });
  }

  static async #findImplicitKnowledgeCandidates({
    identityId,
    item,
  }: {
    identityId: string;
    item: ImplicitKnowledgeItem;
  }) {
    let embedding: number[];

    try {
      const embeddingText = this.#createEmbeddingText({
        title: item.title,
        content: item.content,
      });

      embedding = await AIService.embed(embeddingText);
    } catch (error) {
      logger.warn(
        {
          identityId,
          itemTitle: item.title,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_KNOWLEDGE]: implicit candidate embedding failed',
      );

      return [];
    }

    return AgentKnowledgeDbService.findRelevantMatches({
      identityId,
      embedding,
      limit: this.implicitMergeCandidateLimit,
      minSimilarity: this.implicitMergeMinSimilarity,
    });
  }

  static async #decideImplicitKnowledgeIngestion({
    identityId,
    sourceMessageId,
    item,
    candidates,
  }: {
    identityId: string;
    sourceMessageId: string;
    item: ImplicitKnowledgeItem;
    candidates: AgentKnowledgeSimilarNode[];
  }): Promise<ImplicitKnowledgeIngestionDecision> {
    if (candidates.length === 0) {
      return {
        action: 'create',
        targetPath: undefined,
        parentPath: undefined,
        slug: undefined,
        title: undefined,
        content: undefined,
        reason: undefined,
      };
    }

    const decisionResult = await AIService.generate({
      reasoning: 'high',
      output: Output.object({
        schema: ImplicitKnowledgeIngestionDecisionModelOutputSchema,
        name: 'implicit_knowledge_ingestion_decision',
        description: 'Decision for merging one extracted knowledge item into the active tree.',
      }),
      messages: [
        {
          role: 'user',
          content: dedent`
            # Task

            Decide how to ingest one extracted durable knowledge item into the user's active knowledge tree.

            # Output

            Return an object with this shape:
            {"action":"skip|update|supersede|create","targetPath":"candidate path or null","parentPath":"parent path or null","slug":"slug or null","title":"title or null","content":"content or null","reason":"short reason or null"}

            # Actions

            - "skip": use when an active candidate already stores the same fact well enough, or the item is not worth storing.
            - "update": use when one active candidate should be amended in place. Content must be complete standalone markdown, not a diff.
            - "supersede": use when the new item replaces an old active fact but the old fact should remain historical context.
            - "create": use when no active candidate already covers this item.

            # Rules

            - For "update" and "supersede", targetPath must be exactly one of the candidate paths.
            - Use null for optional fields that do not apply.
            - Do not update broad group/context nodes just because they are nearby. Create a specific note under the right parent instead.
            - Do not overwrite a long project/journal/note candidate unless the extracted item is clearly editing that exact note.
            - Preserve durable history. Example: if the user changed jobs, supersede the old current-job fact instead of overwriting it.
            - For "update", include the full desired final note content.
            - For "create" and "supersede", title and content may improve the extracted item, but keep implicit notes concise.
            - Do not invent facts beyond the extracted item and candidate notes.

            # Extracted Item

            ${JSON.stringify(
              {
                title: item.title,
                content: item.content,
                confidence: item.confidence,
                reason: item.reason,
                parentPath: item.parentPath,
                slug: item.slug,
              },
              null,
              2,
            )}

            # Nearby Active Candidate Notes

            ${candidates.map((candidate) => this.#formatImplicitIngestionCandidate(candidate)).join('\n\n')}
          `,
        },
      ],
    });
    const parsed = ImplicitKnowledgeIngestionDecisionSchema.safeParse(decisionResult.output);

    if (!parsed.success) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Implicit knowledge ingestion decision was invalid.',
        context: {
          identityId,
          sourceMessageId,
          issues: parsed.error.issues,
        },
        retryable: false,
      });
    }

    return parsed.data;
  }

  static async #applyImplicitKnowledgeIngestionDecision({
    identityId,
    threadId,
    sourceMessageId,
    item,
    candidates,
    decision,
  }: {
    identityId: string;
    threadId: string;
    sourceMessageId: string;
    item: ImplicitKnowledgeItem;
    candidates: AgentKnowledgeSimilarNode[];
    decision: ImplicitKnowledgeIngestionDecision;
  }): Promise<ImplicitKnowledgeIngestionOutcome> {
    if (decision.action === 'skip') {
      return {
        action: 'skip',
        targetPath: decision.targetPath,
      };
    }

    if (decision.action === 'update') {
      const target = this.#getDecisionTargetCandidate({
        decision,
        candidates,
        identityId,
        sourceMessageId,
      });
      const updatedNode = await this.updateNodeContent({
        identityId,
        nodeId: target.id,
        title: decision.title ?? target.title,
        content: this.#normalizeRequiredText({
          value: decision.content ?? item.content,
          field: 'content',
          maxCharacters: this.nodeContentCharacterLimit,
        }),
      });

      return {
        action: 'update',
        path: updatedNode.path,
        targetPath: target.path,
      };
    }

    if (decision.action === 'supersede') {
      const target = this.#getDecisionTargetCandidate({
        decision,
        candidates,
        identityId,
        sourceMessageId,
      });
      const draft = this.#resolveImplicitKnowledgeDraft({
        item,
        decision,
        includeItemSlug: false,
      });
      const createdNode = await this.createNode({
        identityId,
        parentPath: draft.parentPath,
        slug: draft.slug,
        title: draft.title,
        content: draft.content,
        source: 'implicit',
        sourceMessageId,
        metadata: this.#createImplicitKnowledgeMetadata({
          item,
          decision,
          threadId,
          targetPath: target.path,
          candidateCount: candidates.length,
        }),
      });
      const replacementNode = this.#requireCreatedNode({
        node: createdNode,
        identityId,
        sourceMessageId,
      });

      await this.supersedeNode({
        identityId,
        nodeId: target.id,
        supersededById: replacementNode.id,
      });

      return {
        action: 'supersede',
        path: replacementNode.path,
        targetPath: target.path,
      };
    }

    const draft = this.#resolveImplicitKnowledgeDraft({
      item,
      decision,
      includeItemSlug: true,
    });
    const createdNode = await this.createNode({
      identityId,
      parentPath: draft.parentPath,
      slug: draft.slug,
      title: draft.title,
      content: draft.content,
      source: 'implicit',
      sourceMessageId,
      metadata: this.#createImplicitKnowledgeMetadata({
        item,
        decision,
        threadId,
        candidateCount: candidates.length,
      }),
    });
    const persistedNode = this.#requireCreatedNode({
      node: createdNode,
      identityId,
      sourceMessageId,
    });

    return {
      action: 'create',
      path: persistedNode.path,
    };
  }

  static #getDecisionTargetCandidate({
    decision,
    candidates,
    identityId,
    sourceMessageId,
  }: {
    decision: ImplicitKnowledgeIngestionDecision;
    candidates: AgentKnowledgeSimilarNode[];
    identityId: string;
    sourceMessageId: string;
  }) {
    const targetPath = decision.targetPath ? this.#normalizePath(decision.targetPath) : null;

    if (!targetPath) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Implicit knowledge ingestion decision is missing a target path.',
        context: {
          identityId,
          sourceMessageId,
          action: decision.action,
        },
        retryable: false,
      });
    }

    const target = candidates.find((candidate) => candidate.path === targetPath);

    if (!target) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Implicit knowledge ingestion decision targeted a non-candidate path.',
        context: {
          identityId,
          sourceMessageId,
          action: decision.action,
          targetPath,
          candidatePaths: candidates.map((candidate) => candidate.path),
        },
        retryable: false,
      });
    }

    return target;
  }

  static #resolveImplicitKnowledgeDraft({
    item,
    decision,
    includeItemSlug,
  }: {
    item: ImplicitKnowledgeItem;
    decision: ImplicitKnowledgeIngestionDecision;
    includeItemSlug: boolean;
  }) {
    return {
      parentPath: decision.parentPath ?? item.parentPath,
      slug: decision.slug ?? (includeItemSlug ? item.slug : undefined),
      title: this.#normalizeRequiredText({
        value: decision.title ?? item.title,
        field: 'title',
        maxCharacters: this.nodeTitleCharacterLimit,
      }),
      content: this.#normalizeRequiredText({
        value: decision.content ?? item.content,
        field: 'content',
        maxCharacters: this.nodeContentCharacterLimit,
      }),
    };
  }

  static #createImplicitKnowledgeMetadata({
    item,
    decision,
    threadId,
    targetPath,
    candidateCount,
  }: {
    item: ImplicitKnowledgeItem;
    decision: ImplicitKnowledgeIngestionDecision;
    threadId: string;
    targetPath?: string;
    candidateCount: number;
  }) {
    return {
      extractionReason: item.reason,
      decisionReason: decision.reason,
      confidence: item.confidence,
      threadId,
      ingestionAction: decision.action,
      targetPath,
      candidateCount,
    };
  }

  static #requireCreatedNode({
    node,
    identityId,
    sourceMessageId,
  }: {
    node: Awaited<ReturnType<typeof AgentKnowledgeService.createNode>>;
    identityId: string;
    sourceMessageId: string;
  }) {
    if (!node) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_TREE_INVARIANT_FAILED,
        message: 'Implicit knowledge node was not created.',
        context: {
          identityId,
          sourceMessageId,
        },
        retryable: true,
      });
    }

    return node;
  }

  static #formatImplicitIngestionCandidate(candidate: AgentKnowledgeSimilarNode) {
    const content = this.#truncateImplicitIngestionCandidateContent(
      candidate.content.trim() || '(empty)',
    );

    return dedent`
      - Path: ${candidate.path}
        Similarity: ${candidate.similarity.toFixed(3)}
        Title: ${candidate.title}
        Content:
        ${content}
    `;
  }

  static #formatImplicitExtractionPathHints(pathHints: AgentKnowledgeSimilarNode[]) {
    if (pathHints.length === 0) {
      return '- none';
    }

    return pathHints
      .map((hint) => {
        const content = this.#truncateText({
          value: hint.content.trim() || '(empty)',
          characterLimit: this.implicitExtractionPathHintContentCharacterLimit,
          marker: '[path hint truncated]',
        });

        return dedent`
          - Path: ${hint.path}
            Similarity: ${hint.similarity.toFixed(3)}
            Title: ${hint.title}
            Content:
            ${content}
        `;
      })
      .join('\n\n');
  }

  static #countImplicitIngestionOutcomes(outcomes: ImplicitKnowledgeIngestionOutcome[]) {
    const counts: Record<ImplicitKnowledgeIngestionAction, number> = {
      skip: 0,
      update: 0,
      supersede: 0,
      create: 0,
    };

    for (const outcome of outcomes) {
      counts[outcome.action] += 1;
    }

    return counts;
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
    const content = node.content.trim() || '(empty)';

    return dedent`
      - [knowledge:${node.relationship}${similarity}] ${node.path}
        Title: ${node.title}
        Content:
        ${content}
    `;
  }

  static #createEmbeddingText({ title, content }: { title: string; content: string }) {
    const embeddingContent = this.#truncateForEmbedding(content);

    return dedent`
      Title: ${title}

      Content:
      ${embeddingContent || '(empty)'}
    `;
  }

  static #normalizeTitle({ value }: { value: string }) {
    return this.#normalizeRequiredText({
      value,
      field: 'title',
      maxCharacters: this.nodeTitleCharacterLimit,
    });
  }

  static #normalizeContent(value: string) {
    return this.#normalizeRequiredText({
      value,
      field: 'content',
      maxCharacters: this.nodeContentCharacterLimit,
    });
  }

  static #normalizeRequiredText({
    value,
    field,
    maxCharacters,
  }: {
    value: string;
    field: string;
    maxCharacters?: number;
  }) {
    const normalized = value.trim();

    if (!normalized) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Knowledge node input is invalid.',
        context: { field },
        retryable: false,
      });
    }

    if (maxCharacters !== undefined && normalized.length > maxCharacters) {
      throw new AppError({
        code: AppErrorCode.KNOWLEDGE_NODE_INVALID,
        message: 'Knowledge node input is too long.',
        context: {
          field,
          characterCount: normalized.length,
          maxCharacters,
        },
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
    const embeddingFields = await this.#createEmbeddingFields({
      identityId,
      operation: 'knowledge.create',
      title,
      content,
    });

    return AgentKnowledgeDbService.createNode({
      identityId,
      parentId,
      slug,
      title,
      content,
      source,
      sourceMessageId,
      metadata,
      ...embeddingFields,
    });
  }

  static async #createEmbeddingFields({
    identityId,
    operation,
    title,
    content,
  }: {
    identityId: string;
    operation: string;
    title: string;
    content: string;
  }) {
    const embeddingText = this.#createEmbeddingText({ title, content });

    try {
      return {
        embedding: await AIService.embed(embeddingText),
        embeddingModel: AIService.embeddingModel,
        embeddingContentHash: this.#hashText(embeddingText),
      };
    } catch (error) {
      logger.warn(
        {
          identityId,
          operation,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_KNOWLEDGE]: embedding generation failed',
      );

      return {
        embedding: undefined,
        embeddingModel: undefined,
        embeddingContentHash: undefined,
      };
    }
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

  static async #resolveMoveParentId({
    identityId,
    newParentPath,
  }: {
    identityId: string;
    newParentPath?: string | null;
  }) {
    const normalizedParentPath = newParentPath ? this.#normalizePath(newParentPath) : null;

    if (!normalizedParentPath) {
      return null;
    }

    const parent = await this.#ensureParentPath({
      identityId,
      path: normalizedParentPath,
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

  static #truncateImplicitIngestionCandidateContent(content: string) {
    return this.#truncateText({
      value: content,
      characterLimit: this.implicitIngestionCandidateContentCharacterLimit,
      marker: '[truncated]',
    });
  }

  static #truncateForEmbedding(content: string) {
    return this.#truncateText({
      value: content,
      characterLimit: this.embeddingContentCharacterLimit,
      marker: '[embedding excerpt truncated]',
    });
  }

  static #truncateText({
    value,
    characterLimit,
    marker,
  }: {
    value: string;
    characterLimit: number;
    marker: string;
  }) {
    if (value.length <= characterLimit) {
      return value;
    }

    return `${value.slice(0, characterLimit)}\n${marker}`;
  }

  static #hashText(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  static async #resolveExploreStartNodeIds({
    identityId,
    startPath,
    queryEmbedding,
    includeInactive,
  }: {
    identityId: string;
    startPath?: string;
    queryEmbedding?: number[];
    includeInactive?: boolean;
  }) {
    if (startPath) {
      const node = await AgentKnowledgeDbService.getNodeByPath({
        identityId,
        path: startPath,
        includeInactive,
      });

      return [node.id];
    }

    if (!queryEmbedding) {
      return [];
    }

    const matches = await AgentKnowledgeDbService.findRelevantMatches({
      identityId,
      embedding: queryEmbedding,
      limit: this.exploreQuerySeedLimit,
      minSimilarity: this.exploreQueryMinSimilarity,
    });

    return matches.map((match) => match.id);
  }

  static #rankExploreNodes({
    nodes,
    query,
    queryEmbedding,
  }: {
    nodes: AgentKnowledgeExploreNode[];
    query?: string;
    queryEmbedding?: number[];
  }) {
    return [...nodes].sort((left, right) => {
      const scoreDifference =
        this.#scoreExploreNode({
          node: right,
          query,
          queryEmbedding,
        }) -
        this.#scoreExploreNode({
          node: left,
          query,
          queryEmbedding,
        });

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      if (left.path === right.path) {
        return 0;
      }

      return left.path < right.path ? -1 : 1;
    });
  }

  static #scoreExploreNode({
    node,
    query,
    queryEmbedding,
  }: {
    node: AgentKnowledgeExploreNode;
    query?: string;
    queryEmbedding?: number[];
  }) {
    const relationshipScore: Record<AgentKnowledgeExploreNode['relationship'], number> = {
      start: 100,
      child: 85,
      descendant: 75,
      ancestor: 60,
      sibling: 45,
    };
    const depthPenalty = Math.min(Math.max(node.depthFromStart, 0), this.exploreMaxDepth) * 2;
    const lexicalScore = query ? this.#getExploreLexicalScore({ node, query }) : 0;
    const semanticScore =
      queryEmbedding && node.embedding
        ? this.#cosineSimilarity(queryEmbedding, node.embedding) * 40
        : 0;

    return relationshipScore[node.relationship] - depthPenalty + lexicalScore + semanticScore;
  }

  static #getExploreLexicalScore({
    node,
    query,
  }: {
    node: AgentKnowledgeExploreNode;
    query: string;
  }) {
    const normalizedQuery = query.toLowerCase();
    const normalizedTitle = node.title.toLowerCase();
    const normalizedPath = node.path.toLowerCase();
    let score = 0;

    if (normalizedTitle.includes(normalizedQuery)) {
      score += 20;
    }

    if (normalizedPath.includes(normalizedQuery.replace(/\s+/g, '-'))) {
      score += 15;
    }

    for (const term of normalizedQuery.split(/\s+/g).filter(Boolean)) {
      if (normalizedTitle.includes(term)) {
        score += 4;
      }

      if (normalizedPath.includes(term)) {
        score += 3;
      }
    }

    return score;
  }

  static #cosineSimilarity(left: number[], right: number[]) {
    let dotProduct = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    const length = Math.min(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
      const leftValue = left[index] ?? 0;
      const rightValue = right[index] ?? 0;

      dotProduct += leftValue * rightValue;
      leftMagnitude += leftValue * leftValue;
      rightMagnitude += rightValue * rightValue;
    }

    if (leftMagnitude === 0 || rightMagnitude === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
  }

  static #getSuggestedExploreNextPaths(nodes: AgentKnowledgeExploreNode[]) {
    return nodes
      .filter((node) => node.childCount > 0)
      .map((node) => node.path)
      .slice(0, 5);
  }

  static #clampNumber({ value, min, max }: { value: number; min: number; max: number }) {
    return Math.min(Math.max(value, min), max);
  }
}

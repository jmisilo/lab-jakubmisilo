import type { Tool } from 'ai';
import type { z } from 'zod';

import { createHash, randomUUID } from 'node:crypto';

import { tool } from 'ai';
import dedent from 'dedent';

import { AgentKnowledgeService } from '@/app/knowledge';
import {
  KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS,
  ManageKnowledgeToolContextSchema,
  ManageKnowledgeToolInputSchema,
  ManageKnowledgeToolOutputSchema,
  ReadKnowledgeToolContextSchema,
  ReadKnowledgeToolInputSchema,
  ReadKnowledgeToolOutputSchema,
} from '@/app/knowledge/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const KNOWLEDGE_TOOL_CONTENT_PREVIEW_CHARACTER_LIMIT = 1_000;
const KNOWLEDGE_TOOL_READ_CONTENT_CHARACTER_LIMIT = 12_000;
const SHOULD_LOG_KNOWLEDGE_TOOL_CONTENT_PREVIEW =
  process.env.AGENT_LOG_KNOWLEDGE_TOOL_CONTENT === '1';

export const readKnowledgeTool: ReadKnowledgeTool = tool({
  description: dedent`
    List, explore, or read durable user-scoped markdown knowledge notes in an Obsidian-style tree.

    # When To Use
    - The user asks what is remembered/saved.
    - The user asks to inspect, show, list, or read saved notes.
    - The user asks a broad question about saved knowledge and relevant details may live under a known or discoverable subtree.
    - You need to find the right note before answering or before using manage-knowledge to edit, move, deactivate, or supersede it.

    # When Not To Use
    - The needed knowledge is already visible in the current context.
    - The request is only to create, update, move, deactivate, or supersede a note. Use manage-knowledge for writes.
    - The user asks for public/current information. Use the appropriate public-data tool instead.

    # Usage
    - Use list to inspect direct child notes. Omit parentPath to list root notes.
    - Use explore to search or traverse a known subtree before reading specific notes. Explore returns bounded previews.
    - Use read for full note content after selecting the right path.
    - For broad topic questions, prefer explore with a concise query, then read only the most relevant paths.
    - For deep project/topic questions, explore descendants from the likely parent path.
  `,
  inputSchema: ReadKnowledgeToolInputSchema,
  outputSchema: ReadKnowledgeToolOutputSchema,
  contextSchema: ReadKnowledgeToolContextSchema,
  execute: async (input, { context }) => {
    const operationId = randomUUID();
    const inputLog = createReadKnowledgeToolInputLog(input);

    logger.info(
      {
        operationId,
        identityId: context.identityId,
        sourceMessageId: context.sourceMessageId,
        input: inputLog,
      },
      '[AGENT_KNOWLEDGE]: read tool started',
    );

    try {
      if (input.action === 'list') {
        const nodes = await AgentKnowledgeService.listNodes({
          identityId: context.identityId,
          parentPath: input.parentPath,
          includeInactive: input.includeInactive,
          limit: input.limit,
        });

        logger.info(
          {
            operationId,
            identityId: context.identityId,
            sourceMessageId: context.sourceMessageId,
            parentPath: input.parentPath,
            nodeCount: nodes.length,
            input: inputLog,
          },
          '[AGENT_KNOWLEDGE]: read tool listed nodes',
        );

        return {
          ok: true,
          message:
            nodes.length > 0
              ? `Loaded ${nodes.length} knowledge note${nodes.length === 1 ? '' : 's'}.`
              : 'No knowledge notes found.',
          operationId,
          nodes: nodes.map((node) => toToolNode(node)),
        };
      }

      if (input.action === 'read') {
        const node = await AgentKnowledgeService.readNodeByPath({
          identityId: context.identityId,
          path: input.path,
          includeInactive: input.includeInactive,
        });

        logger.info(
          {
            operationId,
            identityId: context.identityId,
            sourceMessageId: context.sourceMessageId,
            path: node.path,
            nodeId: node.id,
            input: inputLog,
          },
          '[AGENT_KNOWLEDGE]: read tool read node',
        );

        return {
          ok: true,
          message: `Loaded knowledge note ${node.path}.`,
          operationId,
          node: toToolNode(node, { includeContent: true }),
        };
      }

      const result = await AgentKnowledgeService.exploreNodes({
        identityId: context.identityId,
        startPath: input.startPath,
        query: input.query,
        direction: input.direction,
        maxDepth: input.maxDepth,
        includeInactive: input.includeInactive,
        includeContentPreview: input.includeContentPreview,
        limit: input.limit,
      });

      logger.info(
        {
          operationId,
          identityId: context.identityId,
          sourceMessageId: context.sourceMessageId,
          startPath: input.startPath,
          query: input.query,
          direction: input.direction,
          nodeCount: result.nodes.length,
          truncated: result.truncated,
          input: inputLog,
        },
        '[AGENT_KNOWLEDGE]: read tool explored nodes',
      );

      return {
        ok: true,
        message:
          result.nodes.length > 0
            ? `Explored ${result.nodes.length} knowledge note${result.nodes.length === 1 ? '' : 's'}.`
            : 'No related knowledge notes found.',
        operationId,
        nodes: result.nodes.map((node) =>
          toToolNode(node, {
            includeContentPreview: input.includeContentPreview ?? true,
            includeExploreMetadata: true,
          }),
        ),
        truncated: result.truncated,
        startPaths: result.startPaths,
        suggestedNextPaths: result.suggestedNextPaths,
      };
    } catch (error) {
      logger.error(
        {
          operationId,
          error,
          safeError: ErrorService.toSafeLog(error),
          identityId: context.identityId,
          sourceMessageId: context.sourceMessageId,
          input: inputLog,
        },
        '[AGENT_KNOWLEDGE]: read tool failed',
      );

      return {
        ok: false,
        message: 'Knowledge read request could not be completed.',
        operationId,
      };
    }
  },
});

export const manageKnowledgeTool: ManageKnowledgeTool = tool({
  description: dedent`
    Create, update, deactivate, move, rename, or supersede durable user-scoped markdown knowledge notes in an Obsidian-style tree.

    # When To Use
    - The user explicitly asks to remember, save, note, store, update, correct, forget, archive, or mark information as no longer active.
    - The user asks to rename, move, reorganize, edit, or correct a saved note.
    - The user states a durable personal fact, stable preference, default, relationship, project fact, decision, or useful history.
    - The user asks to preserve a note, idea, journal entry, project detail, design note, plan, or longer markdown content for later.
    - A current fact replaces an older useful fact and the older fact should remain as inactive history.

    # When Not To Use
    - Reading, listing, or exploring saved knowledge. Use read-knowledge for that.
    - Answering from existing knowledge already provided in context.
    - Storing one-off task details, jokes, raw transcripts, or normal conversation summaries.
    - Saving assistant guesses as truth without uncertainty.

    # Do Not Use For
    - Hard-deleting history.
    - Writing provider/tool raw payloads into memory.
    - Creating duplicate notes when the same active note should be updated.
    - Saving content longer than ${KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS} characters into one note. Ask to split it into smaller notes.

    # Usage
    - Use create for new durable notes, including concise memories and longer note-style content.
    - Use update when the same active fact or note should be edited. Update content must be complete standalone markdown, not a diff.
    - Use deactivate for forget/archive/no-longer-remember requests when no replacement is needed. This preserves inactive history instead of deleting.
    - Use move to rename a path, move a note under another parent, or retitle a note while preserving children.
    - Use supersede when an old fact is inactive but historically useful.
    - Use read-knowledge first when you need to locate or inspect the current note before mutating it.
    - Missing parent groups in parentPath are auto-created.
    - Use slash-separated paths such as profile/location, work/current-role, work/history/company-x, projects/lab-agent/knowledge-system, ideas/telegram-agent-scheduling, or journal/2026/07/06.
    - Preserve the user's wording and structure for explicit notes, ideas, and journal entries unless the user asks you to rewrite or summarize.
    - For concise memories, write one focused durable fact per note. For longer notes, use markdown headings/bullets when helpful.
    - Include uncertainty in content when a fact is inferred.
    - Keep implicit/background writes concise. Longer notes should usually be explicit user requests.

    # Examples
    - "Remember that my default city is Warsaw" -> create or update profile/location.
    - "I now work at Company Y" after Company X is known -> create Company Y and supersede Company X.
    - "Actually I prefer concise answers" -> update preferences/communication.
    - "Note this idea: build a Telegram agent that schedules recurring research" -> create ideas/telegram-agent-scheduling or projects/lab-agent/scheduling.
    - "Journal this: ..." -> create journal/YYYY/MM/DD with the user's content preserved.
    - "Forget my old default city" -> deactivate profile/location if that is the active old-city note.
    - "Move that note under projects/lab-agent" -> move the note to projects/lab-agent with the same slug unless a better slug is requested.
  `,
  inputSchema: ManageKnowledgeToolInputSchema,
  outputSchema: ManageKnowledgeToolOutputSchema,
  contextSchema: ManageKnowledgeToolContextSchema,
  execute: async (input, { context }) => {
    const operationId = randomUUID();
    const inputLog = createManageKnowledgeToolInputLog(input);

    logger.info(
      {
        operationId,
        identityId: context.identityId,
        sourceMessageId: context.sourceMessageId,
        input: inputLog,
      },
      '[AGENT_KNOWLEDGE]: manage tool started',
    );

    try {
      if (input.action === 'create') {
        const createdNode = await AgentKnowledgeService.createNode({
          identityId: context.identityId,
          parentPath: input.node.parentPath,
          slug: input.node.slug,
          title: input.node.title,
          content: input.node.content,
          source: 'explicit',
          sourceMessageId: context.sourceMessageId,
        });

        logger.info(
          {
            operationId,
            identityId: context.identityId,
            sourceMessageId: context.sourceMessageId,
            path: createdNode?.path,
            nodeId: createdNode?.id,
            input: inputLog,
          },
          '[AGENT_KNOWLEDGE]: manage tool created node',
        );

        return {
          ok: true,
          message: `Saved knowledge note ${createdNode?.path ?? input.node.title}.`,
          operationId,
          node: createdNode ? toToolNode(createdNode) : undefined,
        };
      }

      if (input.action === 'update') {
        const updatedNode = await AgentKnowledgeService.updateNodeByPath({
          identityId: context.identityId,
          path: input.path,
          title: input.update.title,
          content: input.update.content,
        });

        logger.info(
          {
            operationId,
            identityId: context.identityId,
            sourceMessageId: context.sourceMessageId,
            path: updatedNode.path,
            nodeId: updatedNode.id,
            input: inputLog,
          },
          '[AGENT_KNOWLEDGE]: manage tool updated node',
        );

        return {
          ok: true,
          message: `Updated knowledge note ${updatedNode.path}.`,
          operationId,
          node: toToolNode(updatedNode),
        };
      }

      if (input.action === 'deactivate') {
        const deactivatedNode = await AgentKnowledgeService.deactivateNodeByPath({
          identityId: context.identityId,
          path: input.path,
        });

        logger.info(
          {
            operationId,
            identityId: context.identityId,
            sourceMessageId: context.sourceMessageId,
            path: deactivatedNode.path,
            nodeId: deactivatedNode.id,
            input: inputLog,
          },
          '[AGENT_KNOWLEDGE]: manage tool deactivated node',
        );

        return {
          ok: true,
          message: `Deactivated knowledge note ${deactivatedNode.path}.`,
          operationId,
          node: toToolNode(deactivatedNode),
        };
      }

      if (input.action === 'move') {
        const movedNode = await AgentKnowledgeService.moveNodeByPath({
          identityId: context.identityId,
          path: input.path,
          newParentPath: input.move.parentPath,
          newSlug: input.move.slug,
          title: input.move.title,
        });

        logger.info(
          {
            operationId,
            identityId: context.identityId,
            sourceMessageId: context.sourceMessageId,
            previousPath: input.path,
            path: movedNode.path,
            nodeId: movedNode.id,
            input: inputLog,
          },
          '[AGENT_KNOWLEDGE]: manage tool moved node',
        );

        return {
          ok: true,
          message: `Moved knowledge note ${input.path} to ${movedNode.path}.`,
          operationId,
          node: toToolNode(movedNode),
        };
      }

      const replacementNode = input.node
        ? await AgentKnowledgeService.createNode({
            identityId: context.identityId,
            parentPath: input.node.parentPath,
            slug: input.node.slug,
            title: input.node.title,
            content: input.node.content,
            source: 'explicit',
            sourceMessageId: context.sourceMessageId,
          })
        : null;
      const supersededNode = await AgentKnowledgeService.supersedeNodeByPath({
        identityId: context.identityId,
        path: input.path,
        supersededByPath: replacementNode?.path ?? input.supersededByPath,
      });

      logger.info(
        {
          operationId,
          identityId: context.identityId,
          sourceMessageId: context.sourceMessageId,
          path: input.path,
          supersededByPath: replacementNode?.path ?? input.supersededByPath,
          replacementNodeId: replacementNode?.id,
          supersededNodeId: supersededNode.id,
          input: inputLog,
        },
        '[AGENT_KNOWLEDGE]: manage tool superseded node',
      );

      return {
        ok: true,
        message: `Superseded knowledge note ${supersededNode.path}.`,
        operationId,
        node: replacementNode ? toToolNode(replacementNode) : undefined,
        supersededNode: toToolNode(supersededNode),
      };
    } catch (error) {
      logger.error(
        {
          operationId,
          error,
          safeError: ErrorService.toSafeLog(error),
          identityId: context.identityId,
          sourceMessageId: context.sourceMessageId,
          input: inputLog,
        },
        '[AGENT_KNOWLEDGE]: manage tool failed',
      );

      return {
        ok: false,
        message: 'Knowledge request could not be completed.',
        operationId,
      };
    }
  },
});

function createReadKnowledgeToolInputLog(input: z.infer<typeof ReadKnowledgeToolInputSchema>) {
  if (input.action === 'list') {
    return {
      action: input.action,
      parentPath: input.parentPath,
      includeInactive: input.includeInactive,
      limit: input.limit,
    };
  }

  if (input.action === 'read') {
    return {
      action: input.action,
      path: input.path,
      includeInactive: input.includeInactive,
    };
  }

  return {
    action: input.action,
    startPath: input.startPath,
    query: input.query,
    direction: input.direction,
    maxDepth: input.maxDepth,
    includeInactive: input.includeInactive,
    includeContentPreview: input.includeContentPreview,
    limit: input.limit,
  };
}

function createManageKnowledgeToolInputLog(input: z.infer<typeof ManageKnowledgeToolInputSchema>) {
  if (input.action === 'create') {
    return {
      action: input.action,
      node: createNodeDraftLog(input.node),
    };
  }

  if (input.action === 'update') {
    return {
      action: input.action,
      path: input.path,
      update: {
        title: input.update.title,
        content: createTextLog(input.update.content),
      },
    };
  }

  if (input.action === 'deactivate') {
    return {
      action: input.action,
      path: input.path,
    };
  }

  if (input.action === 'move') {
    return {
      action: input.action,
      path: input.path,
      move: input.move,
    };
  }

  return {
    action: input.action,
    path: input.path,
    supersededByPath: input.supersededByPath,
    node: input.node ? createNodeDraftLog(input.node) : undefined,
  };
}

function createNodeDraftLog(node: {
  parentPath?: string;
  slug?: string;
  title: string;
  content: string;
}) {
  return {
    parentPath: node.parentPath,
    slug: node.slug,
    title: node.title,
    content: createTextLog(node.content),
  };
}

function createTextLog(value: string) {
  const normalizedValue = value.trim();

  return {
    characterCount: normalizedValue.length,
    sha256: createHash('sha256').update(normalizedValue).digest('hex'),
    preview: SHOULD_LOG_KNOWLEDGE_TOOL_CONTENT_PREVIEW
      ? truncateText(normalizedValue, KNOWLEDGE_TOOL_CONTENT_PREVIEW_CHARACTER_LIMIT)
      : undefined,
  };
}

function truncateText(value: string, characterLimit: number) {
  if (value.length <= characterLimit) {
    return value;
  }

  return `${value.slice(0, characterLimit)}[truncated]`;
}

function toToolNode(
  node: {
    id: string;
    parentId: string | null;
    path: string;
    title: string;
    content: string;
    active: boolean;
    relationship?: 'start' | 'ancestor' | 'child' | 'descendant' | 'sibling';
    depthFromStart?: number;
    childCount?: number;
  },
  options: {
    includeContent?: boolean;
    includeContentPreview?: boolean;
    includeExploreMetadata?: boolean;
  } = {},
) {
  const toolNode: {
    id: string;
    path: string;
    parentPath: string | null;
    title: string;
    content?: string;
    contentPreview?: string;
    relationship?: 'start' | 'ancestor' | 'child' | 'descendant' | 'sibling';
    depthFromStart?: number;
    childCount?: number;
    active: boolean;
  } = {
    id: node.id,
    path: node.path,
    parentPath: getParentPath(node.path),
    title: node.title,
    active: node.active,
  };

  if (options.includeContent) {
    toolNode.content = truncateText(node.content, KNOWLEDGE_TOOL_READ_CONTENT_CHARACTER_LIMIT);
  }

  if (options.includeContentPreview) {
    toolNode.contentPreview = truncateText(
      node.content,
      KNOWLEDGE_TOOL_CONTENT_PREVIEW_CHARACTER_LIMIT,
    );
  }

  if (options.includeExploreMetadata) {
    toolNode.relationship = node.relationship;
    toolNode.depthFromStart = node.depthFromStart;
    toolNode.childCount = node.childCount;
  }

  return toolNode;
}

function getParentPath(path: string) {
  const parts = path.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return null;
  }

  return parts.slice(0, -1).join('/');
}

export type ManageKnowledgeTool = Tool<
  z.infer<typeof ManageKnowledgeToolInputSchema>,
  z.infer<typeof ManageKnowledgeToolOutputSchema>,
  z.infer<typeof ManageKnowledgeToolContextSchema>
>;

export type ReadKnowledgeTool = Tool<
  z.infer<typeof ReadKnowledgeToolInputSchema>,
  z.infer<typeof ReadKnowledgeToolOutputSchema>,
  z.infer<typeof ReadKnowledgeToolContextSchema>
>;

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
} from '@/app/knowledge/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const KNOWLEDGE_TOOL_CONTENT_PREVIEW_CHARACTER_LIMIT = 1_000;
const KNOWLEDGE_TOOL_READ_CONTENT_CHARACTER_LIMIT = 12_000;
const SHOULD_LOG_KNOWLEDGE_TOOL_CONTENT_PREVIEW =
  process.env.AGENT_LOG_KNOWLEDGE_TOOL_CONTENT === '1';

export const manageKnowledgeTool: ManageKnowledgeTool = tool({
  description: dedent`
    List, read, create, update, deactivate, move, rename, or supersede durable user-scoped markdown knowledge notes in an Obsidian-style tree.

    # When To Use
    - The user explicitly asks to remember, save, note, store, update, correct, forget, archive, or mark information as no longer active.
    - The user asks what is remembered/saved, asks to inspect a note, asks to show a path, or asks to list notes under a topic.
    - The user asks to rename, move, reorganize, edit, or correct a saved note.
    - The user states a durable personal fact, stable preference, default, relationship, project fact, decision, or useful history.
    - The user asks to preserve a note, idea, journal entry, project detail, design note, plan, or longer markdown content for later.
    - A current fact replaces an older useful fact and the older fact should remain as inactive history.

    # When Not To Use
    - Answering from existing knowledge already provided in context.
    - Storing one-off task details, jokes, raw transcripts, or normal conversation summaries.
    - Saving assistant guesses as truth without uncertainty.

    # Do Not Use For
    - Hard-deleting history.
    - Writing provider/tool raw payloads into memory.
    - Creating duplicate notes when the same active note should be updated.
    - Saving content longer than ${KNOWLEDGE_NODE_CONTENT_MAX_CHARACTERS} characters into one note. Ask to split it into smaller notes.

    # Usage
    - Use list to inspect direct child notes. Omit parentPath to list root notes.
    - Use read when the user asks what a note contains or when you need the current content before editing it.
    - Use create for new durable notes, including concise memories and longer note-style content.
    - Use update when the same active fact or note should be edited. Update content must be complete standalone markdown, not a diff.
    - Use deactivate for forget/archive/no-longer-remember requests when no replacement is needed. This preserves inactive history instead of deleting.
    - Use move to rename a path, move a note under another parent, or retitle a note while preserving children.
    - Use supersede when an old fact is inactive but historically useful.
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
    - "What do you remember about my work?" -> list work, then read relevant child notes if needed.
    - "Forget my old default city" -> deactivate profile/location if that is the active old-city note.
    - "Move that note under projects/lab-agent" -> move the note to projects/lab-agent with the same slug unless a better slug is requested.
  `,
  inputSchema: ManageKnowledgeToolInputSchema,
  outputSchema: ManageKnowledgeToolOutputSchema,
  contextSchema: ManageKnowledgeToolContextSchema,
  execute: async (input, { context }) => {
    const operationId = randomUUID();
    const inputLog = createKnowledgeToolInputLog(input);

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
          '[AGENT_KNOWLEDGE]: manage tool listed nodes',
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
          '[AGENT_KNOWLEDGE]: manage tool read node',
        );

        return {
          ok: true,
          message: `Loaded knowledge note ${node.path}.`,
          operationId,
          node: toToolNode(node, { includeContent: true }),
        };
      }

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

function createKnowledgeToolInputLog(input: z.infer<typeof ManageKnowledgeToolInputSchema>) {
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
  },
  options: { includeContent?: boolean } = {},
) {
  const toolNode: {
    id: string;
    path: string;
    parentPath: string | null;
    title: string;
    content?: string;
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

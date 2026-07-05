import type { Tool } from 'ai';
import type { z } from 'zod';

import { createHash, randomUUID } from 'node:crypto';

import { tool } from 'ai';
import dedent from 'dedent';

import { AgentKnowledgeService } from '@/app/knowledge';
import {
  ManageKnowledgeToolContextSchema,
  ManageKnowledgeToolInputSchema,
  ManageKnowledgeToolOutputSchema,
} from '@/app/knowledge/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export type ManageKnowledgeTool = Tool<
  z.infer<typeof ManageKnowledgeToolInputSchema>,
  z.infer<typeof ManageKnowledgeToolOutputSchema>,
  z.infer<typeof ManageKnowledgeToolContextSchema>
>;

const KNOWLEDGE_TOOL_CONTENT_PREVIEW_CHARACTER_LIMIT = 1_000;
const SHOULD_LOG_KNOWLEDGE_TOOL_CONTENT_PREVIEW =
  process.env.AGENT_LOG_KNOWLEDGE_TOOL_CONTENT === '1';

export const manageKnowledgeTool: ManageKnowledgeTool = tool({
  description: dedent`
    Create, update, or supersede durable user-scoped knowledge notes in an Obsidian-style tree.

    # When To Use
    - The user explicitly asks to remember, save, note, store, update, correct, forget, archive, or mark information as no longer active.
    - The user states a durable personal fact, stable preference, default, relationship, project fact, decision, or useful history.
    - A current fact replaces an older useful fact and the older fact should remain as inactive history.

    # When Not To Use
    - Answering from existing knowledge already provided in context.
    - Storing one-off task details, jokes, raw transcripts, or normal conversation summaries.
    - Saving assistant guesses as truth without uncertainty.

    # Do Not Use For
    - Hard-deleting history.
    - Writing provider/tool raw payloads into memory.
    - Creating duplicate notes when the same active note should be updated.

    # Usage
    - Use create for new durable notes.
    - Use update when the same active fact should be edited.
    - Use supersede when an old fact is inactive but historically useful.
    - Missing parent groups in parentPath are auto-created.
    - Use slash-separated paths such as profile/location, work/current-role, work/history/company-x, or projects/lab-agent/knowledge-system.
    - Include uncertainty in content when a fact is inferred.

    # Examples
    - "Remember that my default city is Warsaw" -> create or update profile/location.
    - "I now work at Company Y" after Company X is known -> create Company Y and supersede Company X.
    - "Actually I prefer concise answers" -> update preferences/communication.
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
        message: `Knowledge could not be updated. Debug ID: ${operationId}.`,
        operationId,
      };
    }
  },
});

function createKnowledgeToolInputLog(input: z.infer<typeof ManageKnowledgeToolInputSchema>) {
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

function toToolNode(node: { id: string; path: string; title: string; active: boolean }) {
  return {
    id: node.id,
    path: node.path,
    title: node.title,
    active: node.active,
  };
}

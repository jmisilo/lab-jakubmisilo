import { createTool } from '@mastra/core/tools';

import { KnowledgeService } from '../../modules/knowledge';
import {
  ManageKnowledgeInputSchema,
  ManageKnowledgeRequestSchema,
  ReadKnowledgeInputSchema,
  ReadKnowledgeRequestSchema,
} from '../../modules/knowledge/schemas';
import { KnowledgeNode } from '../../modules/knowledge/types';
import { resolveIdentityId } from '../runtime-context';

export const readKnowledgeTool = createTool({
  id: 'read_knowledge',
  description:
    "Search, read, list, or explore the user's durable knowledge tree. Use search for semantic discovery, read for a known path, list for direct children, and explore to move through related ancestors or descendants.",
  inputSchema: ReadKnowledgeInputSchema,
  execute: async (input, context) => {
    const identityId = resolveIdentityId(context.requestContext) ?? context.agent?.resourceId;

    if (!identityId) {
      return {
        ok: false,
        message: 'Durable knowledge is unavailable without a user identity.',
      };
    }

    try {
      const request = ReadKnowledgeRequestSchema.parse(input);

      if (request.action === 'search') {
        const nodes = await KnowledgeService.findRelevantNodes({
          identityId,
          query: request.query,
        });

        return {
          ok: true,
          nodes: nodes.map(toToolKnowledgeNode),
        };
      }

      if (request.action === 'read') {
        return {
          ok: true,
          node: toToolKnowledgeNode(
            await KnowledgeService.getNode({
              identityId,
              path: request.path,
            }),
          ),
        };
      }

      if (request.action === 'list') {
        return {
          ok: true,
          nodes: (
            await KnowledgeService.listChildren({
              identityId,
              parentPath: request.parentPath,
            })
          ).map(toToolKnowledgeNode),
        };
      }

      return {
        ok: true,
        nodes: (
          await KnowledgeService.explore({
            identityId,
            path: request.path,
            direction: request.direction,
            depth: request.depth,
          })
        ).map(toToolKnowledgeNode),
      };
    } catch (error) {
      return {
        ok: false,
        message: toSafeKnowledgeError(error, 'Knowledge could not be read right now.'),
      };
    }
  },
});

export const manageKnowledgeTool = createTool({
  id: 'manage_knowledge',
  description:
    'Create, update, move, or deactivate durable user knowledge. Use only for durable facts, preferences, history, notes, ideas, journals, project information, or an explicit request to remember or forget something. A successful result is required before claiming the change was saved.',
  inputSchema: ManageKnowledgeInputSchema,
  execute: async (input, context) => {
    const identityId = resolveIdentityId(context.requestContext) ?? context.agent?.resourceId;

    if (!identityId) {
      return {
        ok: false,
        message: 'Durable knowledge is unavailable without a user identity.',
      };
    }

    try {
      const request = ManageKnowledgeRequestSchema.parse(input);

      if (request.action === 'create') {
        return {
          ok: true,
          node: toToolKnowledgeNode(
            await KnowledgeService.createNode({
              identityId,
              path: request.path,
              title: request.title,
              content: request.content,
            }),
          ),
        };
      }

      if (request.action === 'update') {
        return {
          ok: true,
          node: toToolKnowledgeNode(
            await KnowledgeService.updateNode({
              identityId,
              path: request.path,
              title: request.title,
              content: request.content,
            }),
          ),
        };
      }

      if (request.action === 'move') {
        return {
          ok: true,
          result: await KnowledgeService.moveNode({
            identityId,
            path: request.path,
            destinationPath: request.destinationPath,
          }),
        };
      }

      return {
        ok: true,
        result: await KnowledgeService.deactivateNode({
          identityId,
          path: request.path,
        }),
      };
    } catch (error) {
      return {
        ok: false,
        message: toSafeKnowledgeError(error, 'Knowledge could not be changed right now.'),
      };
    }
  },
});

function toToolKnowledgeNode(node: KnowledgeNode) {
  return {
    path: node.path,
    title: node.title,
    content: node.content,
    active: node.active,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function toSafeKnowledgeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const safePrefixes = [
    'Active knowledge already exists',
    'Active knowledge node',
    'Destination parent',
    'A knowledge node cannot',
    'Knowledge path must',
    'Knowledge tree changed',
  ];

  return safePrefixes.some((prefix) => error.message.startsWith(prefix)) ? error.message : fallback;
}

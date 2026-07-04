import type { MemoryMessageRole } from '@/app/memory/types';

import dedent from 'dedent';

import { AgentContextService } from '@/app/memory/context';
import { AIService } from '@/infrastructure/ai';
import { AgentMemoryDbService } from '@/infrastructure/db/services/agent-memory';
import { logger } from '@/infrastructure/logger';

export class AgentMemoryService {
  static readonly compressionSourceMessageLimit = 200;
  static buildContext = AgentContextService.buildContext.bind(AgentContextService);

  static async recordMessage({
    identityId,
    threadId,
    role,
    content,
    sourceMessageId,
  }: {
    identityId: string;
    threadId: string;
    role: MemoryMessageRole;
    content: string;
    sourceMessageId?: string;
  }) {
    await AgentMemoryDbService.createMessage({
      identityId,
      threadId,
      role,
      content,
      sourceMessageId,
    });
  }

  /**
   * Compresses the oldest uncompressed short-term messages when they exceed the current short-term budget. Returns without writing when under budget.
   */
  static async compressShortTermMemory({
    identityId,
    threadId,
  }: {
    identityId: string;
    threadId: string;
  }) {
    try {
      const uncompressedMessages = await AgentMemoryDbService.getUncompressedMessages({
        identityId,
        threadId,
        limit: this.compressionSourceMessageLimit,
      });
      const totalUncompressedTokens = AgentContextService.countMessagesTokens(uncompressedMessages);
      const compressedChunks = await AgentMemoryDbService.getRecentMemoryChunks({
        identityId,
        threadId,
        limit: AgentContextService.contextCompressedChunkFetchLimit,
      });
      const compressedTokensUsed = AgentContextService.countCompressedTokens(compressedChunks);
      const compressionTriggerTokenLimit = AgentContextService.getCompressionTriggerTokenLimit({
        compressedTokensUsed,
      });

      if (totalUncompressedTokens <= compressionTriggerTokenLimit) {
        logger.debug(
          {
            identityId,
            threadId,
            totalUncompressedTokens,
            compressionTriggerTokenLimit,
          },
          '[AGENT_MEMORY]: short-term memory under compression budget',
        );

        return;
      }

      const messages = AgentContextService.selectCompressionMessages({
        messages: uncompressedMessages,
        totalUncompressedTokens,
      });

      if (messages.length === 0) {
        return;
      }

      logger.debug(
        {
          model: AIService.model,
          messageCount: messages.length,
        },
        '[AGENT_MEMORY]: generating compressed memory summary',
      );

      const transcript = messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n');
      const summary = await AIService.generate({
        messages: [
          {
            role: 'user',
            content: dedent`
              Compress this conversation window into a concise durable memory.

              Preserve:
              - decisions
              - user preferences
              - open tasks
              - durable personal/project facts

              Avoid transient chatter and repeated wording.

              Conversation:
              ${transcript}
            `,
          },
        ],
      });

      await AgentMemoryDbService.createMemoryChunk({
        identityId,
        threadId,
        summary,
        sourceMessageIds: messages.map((message) => message.id),
        metadata: {
          strategy: 'rolling_summary',
          sourceCount: messages.length,
        },
      });

      await AgentMemoryDbService.markMessagesCompressed(messages.map((message) => message.id));

      logger.info(
        {
          identityId,
          threadId,
          compressedMessageCount: messages.length,
          totalUncompressedTokens,
          compressionTriggerTokenLimit,
        },
        '[AGENT_MEMORY]: short-term memory compressed',
      );
    } catch (error) {
      logger.error(
        {
          identityId,
          threadId,
          error,
        },
        '[AGENT_MEMORY]: short-term memory compression failed',
      );
    }
  }
}

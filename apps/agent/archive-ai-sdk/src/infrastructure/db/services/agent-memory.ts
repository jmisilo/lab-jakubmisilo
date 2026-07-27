import type { NewAgentMemoryChunk, NewAgentMessage } from '@/types';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { agentMemoryChunks, agentMessages } from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';

export class AgentMemoryDbService extends DbService {
  static async createMessage(input: NewAgentMessage) {
    const [message] = await this.client.insert(agentMessages).values(input).returning();

    return message ?? null;
  }

  static async getRecentMessages({
    identityId,
    threadId,
    limit,
  }: {
    identityId: string;
    threadId: string;
    limit: number;
  }) {
    const messages = await this.client
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.identityId, identityId),
          eq(agentMessages.threadId, threadId),
          isNull(agentMessages.compressedAt),
        ),
      )
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit);

    // Select the latest N rows first, then restore chronological order.
    return messages.reverse();
  }

  static async getUncompressedMessages({
    identityId,
    threadId,
    limit,
  }: {
    identityId: string;
    threadId: string;
    limit: number;
  }) {
    return this.client
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.identityId, identityId),
          eq(agentMessages.threadId, threadId),
          isNull(agentMessages.compressedAt),
        ),
      )
      .orderBy(asc(agentMessages.createdAt))
      .limit(limit);
  }

  static async countUncompressedMessages({
    identityId,
    threadId,
  }: {
    identityId: string;
    threadId: string;
  }) {
    const [result] = await this.client
      .select({ count: sql<number>`count(*)::int` })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.identityId, identityId),
          eq(agentMessages.threadId, threadId),
          isNull(agentMessages.compressedAt),
        ),
      );

    return result?.count ?? 0;
  }

  static async markMessagesCompressed(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    await this.client
      .update(agentMessages)
      .set({ compressedAt: new Date() })
      .where(inArray(agentMessages.id, ids));
  }

  static async createMemoryChunk(input: NewAgentMemoryChunk) {
    const [chunk] = await this.client.insert(agentMemoryChunks).values(input).returning();

    return chunk ?? null;
  }

  static async getRecentMemoryChunks({
    identityId,
    threadId,
    limit,
  }: {
    identityId: string;
    threadId: string;
    limit: number;
  }) {
    const chunks = await this.client
      .select()
      .from(agentMemoryChunks)
      .where(
        and(eq(agentMemoryChunks.identityId, identityId), eq(agentMemoryChunks.threadId, threadId)),
      )
      .orderBy(desc(agentMemoryChunks.createdAt))
      .limit(limit);

    // Select the latest N rows first, then restore chronological order.
    return chunks.reverse();
  }
}

import type { NewAgentMemoryChunk, NewAgentMessage, NewAgentNotedMemory } from '@/types';

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { cosineDistance } from 'drizzle-orm/sql/functions/vector';

import { agentMemoryChunks, agentMessages, agentNotedMemories } from '@/infrastructure/db/schema';
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

  static async createNotedMemory(input: NewAgentNotedMemory) {
    const [memory] = await this.client.insert(agentNotedMemories).values(input).returning();

    return memory ?? null;
  }

  static async getNotedMemories({ identityId, limit }: { identityId: string; limit: number }) {
    return this.client
      .select()
      .from(agentNotedMemories)
      .where(eq(agentNotedMemories.identityId, identityId))
      .orderBy(desc(agentNotedMemories.updatedAt), desc(agentNotedMemories.importance))
      .limit(limit);
  }

  static async searchNotedMemories({
    identityId,
    embedding,
    limit,
    maxDistance,
  }: {
    identityId: string;
    embedding: number[];
    limit: number;
    maxDistance: number;
  }) {
    const distance = cosineDistance(agentNotedMemories.embedding, embedding);

    return this.client
      .select({
        id: agentNotedMemories.id,
        identityId: agentNotedMemories.identityId,
        kind: agentNotedMemories.kind,
        content: agentNotedMemories.content,
        metadata: agentNotedMemories.metadata,
        embedding: agentNotedMemories.embedding,
        importance: agentNotedMemories.importance,
        createdAt: agentNotedMemories.createdAt,
        updatedAt: agentNotedMemories.updatedAt,
        distance,
      })
      .from(agentNotedMemories)
      .where(
        and(
          eq(agentNotedMemories.identityId, identityId),
          isNotNull(agentNotedMemories.embedding),
          sql`${distance} <= ${maxDistance}`,
        ),
      )
      .orderBy(distance)
      .limit(limit);
  }
}

import Tokenizer from "ai-tokenizer";
import * as o200kBase from "ai-tokenizer/encoding/o200k_base";
import type { ModelMessage } from "ai";
import dedent from "dedent";

import { AIService } from "@/app/ai";
import type {
  MemoryMessageForCompression,
  ShortTermMemory,
} from "@/app/memory/types";
import { AgentMemoryDbService } from "@/infrastructure/db/services/agent-memory";
import { logger } from "@/infrastructure/logger";

export class AgentContextService {
  static readonly contextSourceMessageLimit = 200;
  static readonly contextTokenLimit = 400_000;
  static readonly contextCompressedMemoryRatio = 0.35;
  static readonly contextShortMemoryRatio = 0.35;
  static readonly contextBufferRatio = 0.1;
  static readonly contextEnhancementMemoryRatio = 0.2;
  static readonly contextShortMemoryCompressionRatio = 0.5;
  static readonly contextSemanticNotedMemoryLimit = 12;
  static readonly semanticNotedMemoryMaxCosineDistance = 0.35;
  static readonly contextNotedMemoryFetchLimit = 50;
  static readonly contextCompressedChunkFetchLimit = 30;
  private static readonly tokenizer = new Tokenizer(o200kBase);

  private static get compressedMemoryTokenBudget() {
    return Math.floor(
      this.contextTokenLimit * this.contextCompressedMemoryRatio,
    );
  }

  private static get shortMemoryBaseTokenBudget() {
    return Math.floor(this.contextTokenLimit * this.contextShortMemoryRatio);
  }

  private static get enhancementMemoryTokenBudget() {
    return Math.floor(
      this.contextTokenLimit * this.contextEnhancementMemoryRatio,
    );
  }

  static async buildContext({
    identityId,
    threadId,
    shortTermMemory,
  }: {
    identityId: string;
    threadId: string;
    shortTermMemory: ShortTermMemory[];
  }): Promise<ModelMessage[]> {
    const currentQuery = this.getCurrentQuery(shortTermMemory);
    const queryEmbedding = currentQuery
      ? await AIService.embed(currentQuery)
      : null;

    const [notedMemories, semanticNotedMemories, compressedChunks] =
      await Promise.all([
        AgentMemoryDbService.getNotedMemories({
          identityId,
          limit: this.contextNotedMemoryFetchLimit,
        }),
        queryEmbedding
          ? AgentMemoryDbService.searchNotedMemories({
              identityId,
              embedding: queryEmbedding,
              limit: this.contextSemanticNotedMemoryLimit,
              maxDistance: this.semanticNotedMemoryMaxCosineDistance,
            })
          : [],
        AgentMemoryDbService.getRecentMemoryChunks({
          identityId,
          threadId,
          limit: this.contextCompressedChunkFetchLimit,
        }),
      ]);

    const memoryContext = this.createMemoryContextMessage({
      notedMemories: this.rankNotedMemories({
        semanticNotedMemories,
        recentNotedMemories: notedMemories,
      }),
      compressedChunks,
    });
    const shortMemoryTokenBudget =
      this.shortMemoryBaseTokenBudget +
      Math.max(
        this.compressedMemoryTokenBudget - memoryContext.compressedTokensUsed,
        0,
      );

    const context: ModelMessage[] = [];

    if (memoryContext.content) {
      context.push({
        role: "user",
        content: memoryContext.content,
      });
    }

    const shortTermSelection = this.selectShortTermContext({
      shortTermMemory,
      tokenBudget: shortMemoryTokenBudget,
    });

    context.push(...shortTermSelection.messages);

    logger.info(
      {
        identityId,
        threadId,
        contextMessageCount: context.length,
        shortTermMessageCount: shortTermMemory.length,
        selectedShortTermMessageCount: shortTermSelection.messages.length,
        selectedShortTermTokens: shortTermSelection.usedTokens,
        notedMemoryCount: notedMemories.length,
        semanticNotedMemoryCount: semanticNotedMemories.length,
        selectedNotedMemoryCount: memoryContext.notedMemoryCount,
        selectedNotedMemoryTokens: memoryContext.notedTokensUsed,
        compressedChunkCount: compressedChunks.length,
        selectedCompressedChunkCount: memoryContext.compressedChunkCount,
        selectedCompressedTokens: memoryContext.compressedTokensUsed,
      },
      "[AGENT_MEMORY]: context assembled",
    );

    return context;
  }

  static countMessagesTokens(
    messages: Array<{ role: string; content: string }>,
  ) {
    return messages.reduce(
      (total, message) => total + this.countMemoryMessageTokens(message),
      0,
    );
  }

  static countCompressedTokens(compressedChunks: MemoryChunk[]) {
    return this.selectCompressedMemoryForContext(compressedChunks).usedTokens;
  }

  static getCompressionTriggerTokenLimit({
    compressedTokensUsed,
  }: {
    compressedTokensUsed: number;
  }) {
    return (
      this.shortMemoryBaseTokenBudget +
      Math.max(this.compressedMemoryTokenBudget - compressedTokensUsed, 0)
    );
  }

  static selectCompressionMessages({
    messages,
    totalUncompressedTokens,
  }: {
    messages: MemoryMessageForCompression[];
    totalUncompressedTokens: number;
  }) {
    return this.selectOldestMessagesWithinBudget({
      messages,
      tokenBudget:
        totalUncompressedTokens * this.contextShortMemoryCompressionRatio,
    });
  }

  private static createMemoryContextMessage({
    notedMemories,
    compressedChunks,
  }: {
    notedMemories: NotedMemory[];
    compressedChunks: MemoryChunk[];
  }) {
    const notedSelection = this.selectNotedMemoriesForContext(notedMemories);
    const chunkSelection =
      this.selectCompressedMemoryForContext(compressedChunks);

    const sections: string[] = [];

    if (notedSelection.items.length > 0) {
      sections.push(dedent`
        Noted information:
        ${notedSelection.items.join("\n")}
      `);
    }

    if (chunkSelection.items.length > 0) {
      sections.push(dedent`
        Compressed conversation memory:
        ${chunkSelection.items.join("\n")}
      `);
    }

    if (sections.length === 0) {
      return {
        content: null,
        compressedChunkCount: 0,
        compressedTokensUsed: 0,
        notedMemoryCount: 0,
        notedTokensUsed: 0,
      };
    }

    return {
      content: dedent`
        User context assembled from durable notes and AI-compressed conversation memory. Treat this as user-provided background context. Do not mention it unless it is relevant.

        ${sections.join("\n\n")}
      `,
      compressedChunkCount: chunkSelection.items.length,
      compressedTokensUsed: chunkSelection.usedTokens,
      notedMemoryCount: notedSelection.items.length,
      notedTokensUsed: notedSelection.usedTokens,
    };
  }

  private static rankNotedMemories({
    semanticNotedMemories,
    recentNotedMemories,
  }: {
    semanticNotedMemories: SemanticNotedMemory[];
    recentNotedMemories: NotedMemory[];
  }) {
    const memories = new Map<string, NotedMemory>();

    for (const memory of semanticNotedMemories) {
      memories.set(memory.id, memory);
    }

    for (const memory of recentNotedMemories) {
      if (!memories.has(memory.id)) {
        memories.set(memory.id, memory);
      }
    }

    return [...memories.values()];
  }

  private static selectShortTermContext({
    shortTermMemory,
    tokenBudget,
  }: {
    shortTermMemory: ShortTermMemory[];
    tokenBudget: number;
  }): { messages: ModelMessage[]; usedTokens: number } {
    const selected: ModelMessage[] = [];
    let usedTokens = 0;

    for (const entry of [...shortTermMemory].reverse()) {
      const message: ModelMessage = {
        role: entry.role,
        content: entry.text,
      };
      const tokens = this.countModelMessageTokens(message);

      if (usedTokens + tokens > tokenBudget) {
        if (selected.length === 0) {
          selected.push(message);
        }
        break;
      }

      selected.push(message);
      usedTokens += tokens;
    }

    return { messages: selected.reverse(), usedTokens };
  }

  private static selectNotedMemoriesForContext(notedMemories: NotedMemory[]) {
    return this.selectTextItems({
      sectionTitle: "Noted information:",
      items: notedMemories.map(
        (memory) => `- [${memory.kind}] ${memory.content}`,
      ),
      tokenBudget: this.enhancementMemoryTokenBudget,
    });
  }

  private static selectCompressedMemoryForContext(
    compressedChunks: MemoryChunk[],
  ) {
    return this.selectTextItems({
      sectionTitle: "Compressed conversation memory:",
      items: compressedChunks.map(
        (chunk) => `- [AI-compressed] ${chunk.summary}`,
      ),
      tokenBudget: this.compressedMemoryTokenBudget,
    });
  }

  private static selectTextItems({
    sectionTitle,
    items,
    tokenBudget,
  }: {
    sectionTitle: string;
    items: string[];
    tokenBudget: number;
  }): { items: string[]; usedTokens: number } {
    const selected: string[] = [];
    let usedTokens = this.tokenizer.count(sectionTitle);

    for (const item of items) {
      const tokens = this.tokenizer.count(item);

      if (usedTokens + tokens > tokenBudget) {
        continue;
      }

      selected.push(item);
      usedTokens += tokens;
    }

    return { items: selected, usedTokens };
  }

  private static selectOldestMessagesWithinBudget({
    messages,
    tokenBudget,
  }: {
    messages: MemoryMessageForCompression[];
    tokenBudget: number;
  }) {
    const selected: typeof messages = [];
    let usedTokens = 0;

    for (const message of messages) {
      const tokens = this.countMemoryMessageTokens(message);

      if (usedTokens + tokens > tokenBudget) {
        if (selected.length === 0) {
          selected.push(message);
        }
        break;
      }

      selected.push(message);
      usedTokens += tokens;
    }

    return selected;
  }

  private static countModelMessageTokens(message: ModelMessage) {
    return this.tokenizer.count(
      `${message.role}: ${this.stringifyModelMessageContent(message.content)}`,
    );
  }

  private static countMemoryMessageTokens(message: {
    role: string;
    content: string;
  }) {
    return this.tokenizer.count(`${message.role}: ${message.content}`);
  }

  private static stringifyModelMessageContent(
    content: ModelMessage["content"],
  ) {
    if (typeof content === "string") {
      return content;
    }

    return content
      .map((part) => {
        if (part.type === "text") {
          return part.text;
        }

        return `[${part.type}]`;
      })
      .join("\n");
  }

  private static getCurrentQuery(shortTermMemory: ShortTermMemory[]) {
    return [...shortTermMemory].reverse().find((entry) => entry.role === "user")
      ?.text;
  }
}

type NotedMemory = Awaited<
  ReturnType<typeof AgentMemoryDbService.getNotedMemories>
>[number];
type SemanticNotedMemory = Awaited<
  ReturnType<typeof AgentMemoryDbService.searchNotedMemories>
>[number];
type MemoryChunk = Awaited<
  ReturnType<typeof AgentMemoryDbService.getRecentMemoryChunks>
>[number];

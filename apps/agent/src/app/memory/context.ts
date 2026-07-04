import type { MemoryMessageForCompression, ShortTermMemory } from '@/app/memory/types';
import type { ModelMessage } from 'ai';

import Tokenizer from 'ai-tokenizer';
import * as o200kBase from 'ai-tokenizer/encoding/o200k_base';
import dedent from 'dedent';

import { AgentMemoryDbService } from '@/infrastructure/db/services/agent-memory';
import { logger } from '@/infrastructure/logger';

export class AgentContextService {
  static readonly contextSourceMessageLimit = 200;
  static readonly contextTokenLimit = 400_000;
  static readonly contextCompressedMemoryRatio = 0.35;
  static readonly contextShortMemoryRatio = 0.35;
  static readonly contextBufferRatio = 0.1;
  static readonly contextShortMemoryCompressionRatio = 0.5;
  static readonly contextCompressedChunkFetchLimit = 30;
  static readonly #tokenizer = new Tokenizer(o200kBase);

  static get #compressedMemoryTokenBudget() {
    return Math.floor(this.contextTokenLimit * this.contextCompressedMemoryRatio);
  }

  static get #shortMemoryBaseTokenBudget() {
    return Math.floor(this.contextTokenLimit * this.contextShortMemoryRatio);
  }

  static async buildContext({
    identityId,
    threadId,
    shortTermMemory,
  }: {
    identityId: string;
    threadId: string;
    shortTermMemory: ShortTermMemory[];
  }) {
    const [compressedChunks] = await Promise.all([
      AgentMemoryDbService.getRecentMemoryChunks({
        identityId,
        threadId,
        limit: this.contextCompressedChunkFetchLimit,
      }),
    ]);

    const memoryContext = this.#createMemoryContextMessage({
      compressedChunks,
    });
    const shortMemoryTokenBudget =
      this.#shortMemoryBaseTokenBudget +
      Math.max(this.#compressedMemoryTokenBudget - memoryContext.compressedTokensUsed, 0);

    const context: ModelMessage[] = [];

    if (memoryContext.content) {
      context.push({
        role: 'user',
        content: memoryContext.content,
      });
    }

    const shortTermSelection = this.#selectShortTermContext({
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
        compressedChunkCount: compressedChunks.length,
        selectedCompressedChunkCount: memoryContext.compressedChunkCount,
        selectedCompressedTokens: memoryContext.compressedTokensUsed,
      },
      '[AGENT_MEMORY]: context assembled',
    );

    return context;
  }

  static countMessagesTokens(messages: Array<{ role: string; content: string }>) {
    return messages.reduce((total, message) => total + this.#countMemoryMessageTokens(message), 0);
  }

  static countCompressedTokens(compressedChunks: MemoryChunk[]) {
    return this.#selectCompressedMemoryForContext(compressedChunks).usedTokens;
  }

  static getCompressionTriggerTokenLimit({
    compressedTokensUsed,
  }: {
    compressedTokensUsed: number;
  }) {
    return (
      this.#shortMemoryBaseTokenBudget +
      Math.max(this.#compressedMemoryTokenBudget - compressedTokensUsed, 0)
    );
  }

  static selectCompressionMessages({
    messages,
    totalUncompressedTokens,
  }: {
    messages: MemoryMessageForCompression[];
    totalUncompressedTokens: number;
  }) {
    return this.#selectOldestMessagesWithinBudget({
      messages,
      tokenBudget: totalUncompressedTokens * this.contextShortMemoryCompressionRatio,
    });
  }

  static #createMemoryContextMessage({ compressedChunks }: { compressedChunks: MemoryChunk[] }) {
    const chunkSelection = this.#selectCompressedMemoryForContext(compressedChunks);

    const sections: string[] = [];

    if (chunkSelection.items.length > 0) {
      sections.push(dedent`
        Compressed conversation memory:
        ${chunkSelection.items.join('\n')}
      `);
    }

    if (sections.length === 0) {
      return {
        content: null,
        compressedChunkCount: 0,
        compressedTokensUsed: 0,
      };
    }

    return {
      content: dedent`
        User context assembled from AI-compressed conversation memory. Treat this as user-provided background context. Do not mention it unless it is relevant.

        ${sections.join('\n\n')}
      `,
      compressedChunkCount: chunkSelection.items.length,
      compressedTokensUsed: chunkSelection.usedTokens,
    };
  }

  static #selectShortTermContext({
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
      const tokens = this.#countModelMessageTokens(message);

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

  static #selectCompressedMemoryForContext(compressedChunks: MemoryChunk[]) {
    return this.#selectTextItems({
      sectionTitle: 'Compressed conversation memory:',
      items: compressedChunks.map((chunk) => `- [AI-compressed] ${chunk.summary}`),
      tokenBudget: this.#compressedMemoryTokenBudget,
    });
  }

  static #selectTextItems({
    sectionTitle,
    items,
    tokenBudget,
  }: {
    sectionTitle: string;
    items: string[];
    tokenBudget: number;
  }): { items: string[]; usedTokens: number } {
    const selected: string[] = [];
    let usedTokens = this.#tokenizer.count(sectionTitle);

    for (const item of items) {
      const tokens = this.#tokenizer.count(item);

      if (usedTokens + tokens > tokenBudget) {
        continue;
      }

      selected.push(item);
      usedTokens += tokens;
    }

    return { items: selected, usedTokens };
  }

  static #selectOldestMessagesWithinBudget({
    messages,
    tokenBudget,
  }: {
    messages: MemoryMessageForCompression[];
    tokenBudget: number;
  }) {
    const selected: typeof messages = [];
    let usedTokens = 0;

    for (const message of messages) {
      const tokens = this.#countMemoryMessageTokens(message);

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

  static #countModelMessageTokens(message: ModelMessage) {
    return this.#tokenizer.count(
      `${message.role}: ${this.#stringifyModelMessageContent(message.content)}`,
    );
  }

  static #countMemoryMessageTokens(message: { role: string; content: string }) {
    return this.#tokenizer.count(`${message.role}: ${message.content}`);
  }

  static #stringifyModelMessageContent(content: ModelMessage['content']) {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .map((part) => {
        if (part.type === 'text') {
          return part.text;
        }

        return `[${part.type}]`;
      })
      .join('\n');
  }
}

type MemoryChunk = Awaited<ReturnType<typeof AgentMemoryDbService.getRecentMemoryChunks>>[number];

import type { MemoryMessageForCompression, ShortTermMemory } from '@/app/memory/types';
import type { ModelMessage } from 'ai';

import Tokenizer from 'ai-tokenizer';
import * as o200kBase from 'ai-tokenizer/encoding/o200k_base';
import dedent from 'dedent';

import { AgentKnowledgeService } from '@/app/knowledge';
import { AgentMemoryDbService } from '@/infrastructure/db/services/agent-memory';
import { logger } from '@/infrastructure/logger';

export class AgentContextService {
  static readonly contextSourceMessageLimit = 200;
  static readonly contextTokenLimit = 400_000;
  static readonly contextCompressedMemoryRatio = 0.37;
  static readonly contextShortMemoryRatio = 0.37;
  static readonly contextKnowledgeRatio = 0.22;
  static readonly contextBufferRatio = 0.04;
  static readonly contextShortMemoryCompressionRatio = 0.5;
  static readonly contextCompressedChunkFetchLimit = 30;
  static readonly #tokenizer = new Tokenizer(o200kBase);
  static readonly #textItemTruncationMarker = '\n[truncated to fit context budget]';

  static get #compressedMemoryTokenBudget() {
    return Math.floor(this.contextTokenLimit * this.contextCompressedMemoryRatio);
  }

  static get #shortMemoryBaseTokenBudget() {
    return Math.floor(this.contextTokenLimit * this.contextShortMemoryRatio);
  }

  static get #knowledgeTokenBudget() {
    return Math.floor(this.contextTokenLimit * this.contextKnowledgeRatio);
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
    const [compressedChunks, knowledgeItems] = await Promise.all([
      AgentMemoryDbService.getRecentMemoryChunks({
        identityId,
        threadId,
        limit: this.contextCompressedChunkFetchLimit,
      }),
      AgentKnowledgeService.getContextItems({
        identityId,
        shortTermMemory,
      }),
    ]);

    const memoryContext = this.#createMemoryContextMessage({
      compressedChunks,
      knowledgeItems,
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
        knowledgeItemCount: knowledgeItems.length,
        selectedKnowledgeItemCount: memoryContext.knowledgeItemCount,
        selectedKnowledgeTokens: memoryContext.knowledgeTokensUsed,
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

  static #createMemoryContextMessage({
    compressedChunks,
    knowledgeItems,
  }: {
    compressedChunks: MemoryChunk[];
    knowledgeItems: string[];
  }) {
    const chunkSelection = this.#selectCompressedMemoryForContext(compressedChunks);
    const knowledgeSelection = this.#selectKnowledgeForContext(knowledgeItems);

    const sections: string[] = [];

    if (knowledgeSelection.items.length > 0) {
      sections.push(dedent`
        Durable knowledge:
        ${knowledgeSelection.items.join('\n')}
      `);
    }

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
        knowledgeItemCount: 0,
        knowledgeTokensUsed: 0,
      };
    }

    return {
      content: dedent`
        User context assembled from durable knowledge and AI-compressed conversation memory. Treat this as user-provided background context. Do not mention it unless it is relevant.

        ${sections.join('\n\n')}
      `,
      compressedChunkCount: chunkSelection.items.length,
      compressedTokensUsed: chunkSelection.usedTokens,
      knowledgeItemCount: knowledgeSelection.items.length,
      knowledgeTokensUsed: knowledgeSelection.usedTokens,
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

  static #selectKnowledgeForContext(knowledgeItems: string[]) {
    return this.#selectTextItems({
      sectionTitle: 'Durable knowledge:',
      items: knowledgeItems,
      tokenBudget: this.#knowledgeTokenBudget,
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
    if (items.length === 0) {
      return { items: [], usedTokens: 0 };
    }

    const selected: string[] = [];
    let usedTokens = this.#tokenizer.count(sectionTitle);

    for (const item of items) {
      const tokens = this.#tokenizer.count(item);

      if (usedTokens + tokens > tokenBudget) {
        const truncatedItem = this.#truncateTextItemToTokenBudget({
          item,
          tokenBudget: tokenBudget - usedTokens,
        });

        if (truncatedItem) {
          selected.push(truncatedItem);
          usedTokens += this.#tokenizer.count(truncatedItem);
        }

        break;
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

  static #truncateTextItemToTokenBudget({
    item,
    tokenBudget,
  }: {
    item: string;
    tokenBudget: number;
  }) {
    const marker = this.#textItemTruncationMarker;
    const markerTokens = this.#tokenizer.count(marker);

    if (tokenBudget <= markerTokens + 1) {
      return null;
    }

    const itemTokens = this.#tokenizer.encode(item);
    let low = 1;
    let high = Math.min(itemTokens.length, tokenBudget - markerTokens);
    let best: string | null = null;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const prefix = this.#tokenizer.decode(itemTokens.slice(0, middle)).trimEnd();
      const candidate = `${prefix}${marker}`;

      if (prefix && this.#tokenizer.count(candidate) <= tokenBudget) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return best;
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

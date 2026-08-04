import type { Logger as ChatLogger } from 'chat';

import { createPostgresState } from '@chat-adapter/state-pg';
import { blooio } from '@imessage-sdk/blooio';
import { createIMessageAdapter } from '@imessage-sdk/chat-adapter';
import { Chat } from 'chat';

import { logger } from '../../infrastructure/logger';

const SAFE_CHAT_LOG_KEYS = new Set([
  'adapter',
  'command',
  'emoji',
  'lockKey',
  'method',
  'mode',
  'runtimeMode',
  'status',
]);

const imessageAdapter = createIMessageAdapter({
  provider: blooio(),
});

/**
 * Chat SDK is the transport boundary. It owns webhook verification,
 * deduplication, queueing, thread locks, and platform posting. Mastra Memory
 * is the only conversation transcript, so Chat transcripts/history are not
 * configured here.
 */
export const chatState = createPostgresState({
  url: process.env.DATABASE_URL,
  keyPrefix: 'agent',
  logger: createChatLogger('chat-state'),
});

export const chat = new Chat({
  userName: 'agent',
  adapters: { imessage: imessageAdapter },
  state: chatState,
  identity: ({ author }) => author.userId,
  concurrency: 'queue',
  dedupeTtlMs: 10 * 60 * 1_000,
  fallbackStreamingPlaceholderText: null,
  logger: createChatLogger('chat'),
});

function createChatLogger(component: string): ChatLogger {
  const child = logger.child({ component });

  return {
    child(prefix) {
      return createChatLogger(`${component}:${prefix}`);
    },
    debug(message, ...args) {
      child.debug(message, toLogMetadata(args));
    },
    info(message, ...args) {
      child.info(message, toLogMetadata(args));
    },
    warn(message, ...args) {
      child.warn(message, toLogMetadata(args));
    },
    error(message, ...args) {
      child.error(message, toLogMetadata(args));
    },
  };
}

function toLogMetadata(args: unknown[]) {
  const metadata: Record<string, unknown> = {};

  for (const argument of args) {
    if (argument instanceof Error) {
      metadata.safeError = { name: argument.name, message: argument.message.slice(0, 500) };
      continue;
    }

    if (!argument || typeof argument !== 'object' || Array.isArray(argument)) {
      continue;
    }

    for (const [key, value] of Object.entries(argument)) {
      if (key === 'error' && value instanceof Error) {
        metadata.safeError = { name: value.name, message: value.message.slice(0, 500) };
      } else if (isSafeChatLogField(key, value)) {
        metadata[key] = value;
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function isSafeChatLogField(key: string, value: unknown) {
  const safeKey =
    SAFE_CHAT_LOG_KEYS.has(key) ||
    key.endsWith('Count') ||
    key.endsWith('Id') ||
    key.endsWith('Ids') ||
    key.endsWith('Ms') ||
    /^(?:has|is)[A-Z]/.test(key);

  if (!safeKey) {
    return false;
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }

  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

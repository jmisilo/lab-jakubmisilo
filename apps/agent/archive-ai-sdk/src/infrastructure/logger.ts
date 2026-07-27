import type { Logger as ChatLogger } from 'chat';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import pino from 'pino';

import { ErrorService } from '@/infrastructure/errors';

const logFile = process.env.AGENT_LOG_FILE;
const defaultLogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const loggerOptions = {
  level: process.env.LOG_LEVEL ?? process.env.CHAT_SDK_LOG_LEVEL ?? defaultLogLevel,
  redact: {
    paths: [
      'accessToken',
      'apiKey',
      'authorization',
      'cookie',
      'password',
      'refreshToken',
      'secret',
      'token',
      '*.accessToken',
      '*.apiKey',
      '*.authorization',
      '*.cookie',
      '*.password',
      '*.refreshToken',
      '*.secret',
      '*.token',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    remove: true,
  },
};

if (logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
}

export const logger = logFile
  ? pino(loggerOptions, pino.destination({ dest: logFile, sync: false }))
  : pino(loggerOptions);

const createChatLogger = (component: string): ChatLogger => {
  const child = logger.child({ component });

  return {
    child(prefix) {
      return createChatLogger(`${component}:${prefix}`);
    },
    debug(message, ...args) {
      const metadata = getSafeChatLogMetadata(args);

      if (metadata) {
        child.debug(metadata, message);
      } else {
        child.debug(message);
      }
    },
    error(message, ...args) {
      const metadata = getSafeChatLogMetadata(args);

      if (metadata) {
        child.error(metadata, message);
      } else {
        child.error(message);
      }
    },
    info(message, ...args) {
      const metadata = getSafeChatLogMetadata(args);

      if (metadata) {
        child.info(metadata, message);
      } else {
        child.info(message);
      }
    },
    warn(message, ...args) {
      const metadata = getSafeChatLogMetadata(args);

      if (metadata) {
        child.warn(metadata, message);
      } else {
        child.warn(message);
      }
    },
  };
};

export const chatLogger = createChatLogger('chat-sdk');

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

function getSafeChatLogMetadata(args: unknown[]) {
  const metadata: Record<string, unknown> = {};

  for (const argument of args) {
    if (argument instanceof Error) {
      metadata.safeError = ErrorService.toSafeLog(argument);
      continue;
    }

    if (!argument || typeof argument !== 'object' || Array.isArray(argument)) {
      continue;
    }

    for (const [key, value] of Object.entries(argument)) {
      if (key === 'error' && value instanceof Error) {
        metadata.safeError = ErrorService.toSafeLog(value);
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

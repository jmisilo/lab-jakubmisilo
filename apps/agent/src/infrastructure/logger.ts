import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import pino from "pino";
import type { Logger as ChatLogger } from "chat";

const logFile = process.env.AGENT_LOG_FILE;
const defaultLogLevel =
  process.env.NODE_ENV === "production" ? "debug" : "info";
const loggerOptions = {
  level:
    process.env.LOG_LEVEL ?? process.env.CHAT_SDK_LOG_LEVEL ?? defaultLogLevel,
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
      child.debug({ args }, message);
    },
    error(message, ...args) {
      child.error({ args }, message);
    },
    info(message, ...args) {
      child.info({ args }, message);
    },
    warn(message, ...args) {
      child.warn({ args }, message);
    },
  };
};

export const chatLogger = createChatLogger("chat-sdk");

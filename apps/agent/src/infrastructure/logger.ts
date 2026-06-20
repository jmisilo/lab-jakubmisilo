import pino from "pino";
import type { Logger as ChatLogger } from "chat";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? process.env.CHAT_SDK_LOG_LEVEL ?? "info",
});

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

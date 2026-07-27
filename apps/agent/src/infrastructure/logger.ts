import { PinoLogger } from '@mastra/loggers';

export const logger = new PinoLogger({
  name: 'agent',
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  prettyPrint: process.env.NODE_ENV !== 'production',
  redact: {
    paths: [
      'authorization',
      '*.authorization',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'apiKey',
      '*.apiKey',
      'token',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

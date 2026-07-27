import type { Config } from 'jest';

import config from '@labjm/jest-config/node';

const agentConfig: Config = {
  ...config,
  modulePathIgnorePatterns: ['<rootDir>/.vercel'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    ...(config.moduleNameMapper ?? {}),
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
};

export default agentConfig;

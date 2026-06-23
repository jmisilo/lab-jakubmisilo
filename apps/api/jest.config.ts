import type { Config } from 'jest';

import { createRequire } from 'node:module';

const localRequire = createRequire(`${process.cwd()}/jest.config.ts`);
const config = localRequire('../../packages/jest-config/node.ts') as Config;

export default config;

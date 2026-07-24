import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 180_000,
    include: ['src/mastra/evals/**/*.eval.ts'],
    maxWorkers: 1,
    testTimeout: 180_000,
  },
});

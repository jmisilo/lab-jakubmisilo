import type { Linter } from 'eslint';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import globals from 'globals';

import { config } from '@labjm/eslint-config/base';

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

const eslintConfig: Linter.Config[] = [
  {
    ignores: ['.vercel/**', 'dist/**'],
  },
  ...config,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        tsconfigRootDir,
      },
    },
  },
] satisfies Linter.Config[];

export default eslintConfig;

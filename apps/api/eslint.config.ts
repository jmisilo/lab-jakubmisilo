import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Linter } from "eslint";
import globals from "globals";
import { config } from "@labjm/eslint-config/base";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

const eslintConfig: Linter.Config[] = [
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

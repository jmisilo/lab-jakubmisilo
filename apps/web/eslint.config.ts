import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Linter } from "eslint";
import { nextJsConfig } from "@labjm/eslint-config/next-js";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

const eslintConfig: Linter.Config[] = [
  ...nextJsConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir,
      },
    },
  },
] satisfies Linter.Config[];

export default eslintConfig;

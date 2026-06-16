import { createRequire } from "node:module";
import type { Config } from "jest";

const localRequire = createRequire(`${process.cwd()}/jest.config.ts`);
const config = localRequire("../../packages/jest-config/next.ts") as Config;

export default config;

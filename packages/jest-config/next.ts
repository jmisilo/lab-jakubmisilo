import type { Config } from "jest";

const nextJest = require("next/jest.js")
  .default as typeof import("next/jest.js").default;

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  clearMocks: true,
  coverageProvider: "v8",
  testEnvironment: "jsdom",
};

export = createJestConfig(config);

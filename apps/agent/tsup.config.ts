import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  dts: false,
  entry: ["src/index.ts", "src/app/tui/index.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  target: "node24",
});

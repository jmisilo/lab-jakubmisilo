import type { Options } from 'tsup';

import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'tsup';

const copySkillsPlugin = {
  name: 'copy-agent-skills',
  buildEnd() {
    const source = resolve('src/skills');
    const target = resolve('dist/skills');

    if (!existsSync(source)) {
      return;
    }

    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
  },
} satisfies NonNullable<Options['plugins']>[number];

export default defineConfig({
  bundle: true,
  clean: true,
  dts: false,
  entry: ['src/index.ts', 'src/app/tui/index.ts'],
  format: ['esm'],
  loader: {
    '.woff': 'binary',
  },
  noExternal: [/^@fontsource\/inter/, /^@labjm\//],
  outDir: 'dist',
  platform: 'node',
  plugins: [copySkillsPlugin],
  target: 'node24',
});

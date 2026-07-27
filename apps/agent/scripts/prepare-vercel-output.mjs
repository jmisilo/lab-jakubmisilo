import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outputDirectory = join('.vercel', 'output');
const studioIndexPath = join(outputDirectory, 'static', 'index.html');
const functionNodeModules = join(outputDirectory, 'functions', 'index.func', 'node_modules');

if (existsSync(studioIndexPath)) {
  const studioHtml = readFileSync(studioIndexPath, 'utf8');
  const defaultPrefix = "window.MASTRA_API_PREFIX = '/api';";
  const configuredPrefix = "window.MASTRA_API_PREFIX = '/api/mastra';";

  if (!studioHtml.includes(defaultPrefix) && !studioHtml.includes(configuredPrefix)) {
    throw new Error('Mastra Studio API prefix configuration was not found.');
  }

  writeFileSync(studioIndexPath, studioHtml.replace(defaultPrefix, configuredPrefix));
}

if (!existsSync(functionNodeModules)) {
  process.exit(0);
}

const pnpmStore = join(functionNodeModules, '.pnpm');
const requiredSharpPackages = ['@img+sharp-linux-x64@', '@img+sharp-libvips-linux-x64@'];

if (existsSync(pnpmStore)) {
  for (const packageName of readdirSync(pnpmStore)) {
    if (
      packageName.startsWith('@img+sharp-') &&
      !requiredSharpPackages.some((requiredPackage) => packageName.startsWith(requiredPackage))
    ) {
      rmSync(join(pnpmStore, packageName), { recursive: true, force: true });
    }
  }
}

const imagePackages = join(functionNodeModules, '@img');
const requiredImagePackages = new Set(['sharp-linux-x64', 'sharp-libvips-linux-x64']);

if (existsSync(imagePackages)) {
  for (const packageName of readdirSync(imagePackages)) {
    if (!requiredImagePackages.has(packageName)) {
      rmSync(join(imagePackages, packageName), { recursive: true, force: true });
    }
  }
}

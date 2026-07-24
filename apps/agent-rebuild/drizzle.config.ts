import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to manage the agent-rebuild database schema.');
}

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  out: './src/infrastructure/database/drizzle',
  schema: './src/infrastructure/database/schema.ts',
  tablesFilter: ['agent_rebuild_*'],
  strict: true,
  verbose: true,
});

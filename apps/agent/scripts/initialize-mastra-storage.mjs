import { PostgresStore } from '@mastra/pg';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to initialize Mastra storage.');
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  allowExitOnIdle: true,
});
const storage = new PostgresStore({
  id: 'agent-storage-initialization',
  pool,
  schemaName: 'mastra',
});

try {
  await storage.init();
} finally {
  await pool.end();
}

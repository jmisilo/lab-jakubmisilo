import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from '@/infrastructure/db/schema';

const SERVERLESS_POOL_MAX_CONNECTIONS = 5;
const SERVERLESS_POOL_IDLE_TIMEOUT_MS = 5_000;
const SERVERLESS_POOL_CONNECTION_TIMEOUT_MS = 10_000;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for agent database access');
}

export const dbPool = new pg.Pool({
  connectionString: normalizeDatabaseUrl(databaseUrl),
  max: SERVERLESS_POOL_MAX_CONNECTIONS,
  idleTimeoutMillis: SERVERLESS_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: SERVERLESS_POOL_CONNECTION_TIMEOUT_MS,
  allowExitOnIdle: true,
});

attachDatabasePool(dbPool);

export const db = drizzle(dbPool, { schema });

function normalizeDatabaseUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const sslMode = parsedUrl.searchParams.get('sslmode');

    if (sslMode && ['prefer', 'require', 'verify-ca'].includes(sslMode)) {
      parsedUrl.searchParams.set('sslmode', 'verify-full');
    }

    return parsedUrl.toString();
  } catch {
    return url;
  }
}

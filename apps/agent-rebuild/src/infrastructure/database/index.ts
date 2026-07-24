import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for agent database access.');
}

export const databasePool = new pg.Pool({
  connectionString: databaseUrl,
  allowExitOnIdle: true,
});

export const database = drizzle(databasePool, { schema });

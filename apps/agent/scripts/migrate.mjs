import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = join(packageRoot, 'src/infrastructure/db/drizzle');

config({ path: join(packageRoot, '.env.local'), quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run database migrations.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let client;

try {
  client = await pool.connect();
  await client.query("select pg_advisory_lock(hashtext('labjm-agent-migration-baseline'))");
  await migrate(drizzle(client), { migrationsFolder });
  console.info('Agent database migrations applied successfully.');
} catch (error) {
  console.error(formatMigrationError(error));
  process.exitCode = 1;
} finally {
  if (client) {
    client.release(true);
  }

  await pool.end();
}

function formatMigrationError(error) {
  const messages = [];
  const seen = new Set();
  let current = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);

    const code = typeof current.code === 'string' ? ` [${current.code}]` : '';
    const context = ['schema', 'table', 'column', 'constraint']
      .flatMap((key) => (typeof current[key] === 'string' ? [`${key}=${current[key]}`] : []))
      .join(', ');

    messages.push(
      `${messages.length === 0 ? 'Migration failed' : 'Caused by'}${code}: ${current.message}${
        context ? ` (${context})` : ''
      }`,
    );
    current = current.cause;
  }

  return messages.join('\n');
}

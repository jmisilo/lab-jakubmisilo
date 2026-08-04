import { createPostgresState } from '@chat-adapter/state-pg';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to initialize Chat SDK state.');
}

const state = createPostgresState({ url: databaseUrl, keyPrefix: 'agent' });

try {
  await state.connect();
} finally {
  await state.disconnect();
}

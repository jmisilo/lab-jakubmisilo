# @labjm/agent

Custom AI agent. Provide Telegram bot credentials to deploy the agent and receive messages on Telegram.

## Features

- **Local TUI** — terminal chat UI for testing the agent locally
- **Telegram bot** — webhook endpoint for direct messages, mentions, and subscribed threads
- **Memory** — PostgreSQL-backed chat state and agent memory

## Environment

```sh
cp .env.local.example .env.local
```

Fill the provider and integration keys:

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `DATABASE_URL`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

## Development

From the repo root:

```sh
pnpm dev
```

This starts the agent TUI alongside the other workspace apps.

To run only the agent:

```sh
pnpm --filter @labjm/agent dev
```

The agent webhook server is available through:

```sh
pnpm --filter @labjm/agent dev:server
```

Health check:

```sh
curl http://localhost:2000/health
```

Telegram webhook endpoint:

```txt
POST /webhooks/telegram
```

World Cup polling endpoint, called by QStash schedules:

```txt
GET /jobs/world-cup/events
```

The route verifies the `upstash-signature` header with `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.

The schedule window is every minute from 17:45 through 09:59 the next day in `Europe/Warsaw`:

```txt
CRON_TZ=Europe/Warsaw 45-59 17 * * *
CRON_TZ=Europe/Warsaw * 18-23 * * *
CRON_TZ=Europe/Warsaw * 0-9 * * *
```

## Database

Drizzle-managed app tables live in the `public` PostgreSQL schema, including the temporary `world_cup_2026_*` tables.

Chat SDK state tables also live in `public`, but `db:push` excludes `chat_state_*` through `tablesFilter` because those tables are owned by `@chat-adapter/state-pg`. The two Chat SDK `bigserial` backing sequences are declared in Drizzle so they are not treated as orphaned public sequences.

If Chat SDK state tables were moved to a temporary `chat_state` schema, move them back before deploying:

```sql
ALTER TABLE IF EXISTS chat_state.chat_state_subscriptions SET SCHEMA public;
ALTER TABLE IF EXISTS chat_state.chat_state_locks SET SCHEMA public;
ALTER TABLE IF EXISTS chat_state.chat_state_cache SET SCHEMA public;
ALTER TABLE IF EXISTS chat_state.chat_state_lists SET SCHEMA public;
ALTER TABLE IF EXISTS chat_state.chat_state_queues SET SCHEMA public;

ALTER SEQUENCE IF EXISTS chat_state.chat_state_lists_seq_seq SET SCHEMA public;
ALTER SEQUENCE IF EXISTS chat_state.chat_state_queues_seq_seq SET SCHEMA public;

DROP SCHEMA IF EXISTS chat_state;
```

If temporary World Cup tables were previously created in the old `world_cup` schema, remove that duplicate schema after confirming `public.world_cup_2026_*` has the desired data:

```sql
DROP SCHEMA IF EXISTS world_cup CASCADE;
```

```sh
pnpm --filter @labjm/agent db:push
```

Expected `db:push` output should not drop `chat_state_*` tables or sequences.

## Stack

- [AI SDK](https://sdk.vercel.ai) — agent runtime and model calls
- [AI SDK TUI](https://sdk.vercel.ai) — local terminal UI
- [Chat SDK](https://www.npmjs.com/package/chat) — Telegram bot adapter and chat state
- [Hono](https://hono.dev) — webhook server
- [Drizzle](https://orm.drizzle.team) — PostgreSQL schema and migrations

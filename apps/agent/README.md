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
- `TELEGRAM_ALLOWED_USER_IDS` — [TEMP] optional comma-separated Telegram numeric user IDs allowed to use the bot
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

To restrict bot usage during development, set `TELEGRAM_ALLOWED_USER_IDS`:

```sh
TELEGRAM_ALLOWED_USER_IDS="123456789,987654321"
```

Leave it empty to allow all Telegram users.

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

## Deployment to Vercel

The agent is deployed as a Vercel Node function from the `apps/agent` workspace package. The Vercel project must use:

- **Root Directory**: `apps/agent`
- **Build Command**: `pnpm build`
- **Output Directory**: `dist`
- **Database**: Neon Postgres via `DATABASE_URL`

`vercel.json` already defines the build/output settings and rewrites all traffic to the Hono app entrypoint.

### 1. Create the Neon database

Create a Neon Postgres project for the agent and use its connection string as `DATABASE_URL`.

Recommended setup:

- Use the Neon pooled connection string for Vercel runtime.
- Keep all app tables in the `public` schema.
- Do not rely on `search_path` connection options; Neon pooled connections can reject unsupported startup parameters.
- If a local `db:push` ever has issues with the pooled URL, temporarily use Neon’s direct/unpooled URL locally for the push, then keep Vercel runtime on the pooled URL.

Before deploying the app, push the Drizzle schema to Neon:

```sh
pnpm --filter @labjm/agent db:push
```

Review the generated statements before accepting them. The expected output should not drop `chat_state_*` tables or their sequences.

### 2. Configure Vercel environment variables

Set these in the Vercel project for the environments you deploy to:

Required:

- `DATABASE_URL` — Neon Postgres connection string
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS` — optional comma-separated allowlist while the agent is private
- `TELEGRAM_BOT_USERNAME` — optional, defaults to `labjm_assistant_bot`
- `OPENWEATHER_API_KEY` — required for weather and local-time tools
- `QSTASH_CURRENT_SIGNING_KEY` — required for QStash-signed World Cup polling and scheduled-task execution
- `QSTASH_NEXT_SIGNING_KEY` — required for QStash-signed World Cup polling and scheduled-task execution
- `QSTASH_TOKEN` — required for creating QStash one-time messages and recurring schedules
- `AGENT_PUBLIC_URL` — stable public base URL used as the QStash scheduled-task destination, for example `https://agent.example.com`

Add the optional env vars the same way when those integrations are enabled.

### 3. Deploy

Preferred flow is git-connected Vercel deployment: merge/push to the production branch after the project is linked to Vercel.

Manual CLI deployment:

```sh
vercel --cwd apps/agent deploy --prod
```

### 4. Configure Telegram webhook

Point Telegram at the deployed agent URL:

```sh
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<agent-domain>/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN"
```

The `secret_token` must match `TELEGRAM_WEBHOOK_SECRET_TOKEN` in Vercel.

### 5. Configure QStash schedules, if World Cup polling is enabled

Use QStash schedules that call:

```txt
GET https://<agent-domain>/jobs/world-cup/events
```

The route verifies QStash signatures with `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`; it does not use a separate cron secret.

Current polling window:

```txt
CRON_TZ=Europe/Warsaw 45-59 17 * * *
CRON_TZ=Europe/Warsaw * 18-23 * * *
CRON_TZ=Europe/Warsaw * 0-9 * * *
```

Generic user scheduling does not need a periodic polling cron. The `manage-schedule` tool creates QStash delayed messages for one-time tasks and QStash schedules for recurring tasks. QStash calls:

```txt
POST https://<agent-domain>/jobs/schedules/execute
```

The route verifies QStash signatures with `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.

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

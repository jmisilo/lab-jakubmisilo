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

## Database

```sh
pnpm --filter @labjm/agent db:generate
pnpm --filter @labjm/agent db:migrate
```

## Stack

- [AI SDK](https://sdk.vercel.ai) — agent runtime and model calls
- [AI SDK TUI](https://sdk.vercel.ai) — local terminal UI
- [Chat SDK](https://www.npmjs.com/package/chat) — Telegram bot adapter and chat state
- [Hono](https://hono.dev) — webhook server
- [Drizzle](https://orm.drizzle.team) — PostgreSQL schema and migrations

# lab-jakubmisilo

Guidance for coding agents working in this repository.

## Commands

Run commands from the repository root unless a package-specific command is shown.

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Package-scoped commands:

```sh
pnpm --filter @labjm/web dev
pnpm --filter @labjm/api dev
pnpm --filter @labjm/agent dev
pnpm --filter @labjm/agent dev:server
pnpm --filter @labjm/agent db:generate
pnpm --filter @labjm/agent db:migrate
```

Use `pnpm` for dependency changes. Do not hand-edit `pnpm-lock.yaml`.

## Architecture

This is a pnpm + Turborepo monorepo. Packages are ESM TypeScript.

- `apps/web` — Next.js site and AI widget UI.
- `apps/api` — Hono API powering the web app.
- `apps/agent` — Hono + Chat SDK Telegram and iMessage agent with AI SDK tools, memory, weather, and World Cup notifications.
- `packages/ai` — AI widget tools and UI message types.
- `packages/schemas` — shared Zod schemas.
- `packages/types` — shared inferred types.
- `packages/utilities` — small shared utilities.
- `packages/eslint-config`, `packages/jest-config`, `packages/typescript-config` — workspace tooling.

## Agent App

The Telegram agent is in `apps/agent`.

- Webhook entrypoint: `apps/agent/src/index.ts`.
- Chat SDK setup and Telegram handlers: `apps/agent/src/app/bot/index.ts`.
- AI agent runtime and tool registration: `apps/agent/src/app/agent`.
- Memory services and context assembly: `apps/agent/src/app/memory`.
- Weather tools: `apps/agent/src/app/features/weather`.
- World Cup tools, polling, subscription, and notification delivery: `apps/agent/src/app/features/world-cup`.
- Drizzle schema and DB services: `apps/agent/src/infrastructure/db`.
- Google, OpenWeather, and World Cup provider clients: `apps/agent/src/infrastructure`.

Keep external systems behind service boundaries. Do not call provider SDKs, Telegram APIs, or database tables directly from unrelated application code.

## Chat SDK Notes

Chat SDK normalizes platform events into `Thread` and `Message`.

- Gate incoming Telegram messages before side effects such as `thread.subscribe()`, transcript writes, memory writes, or model calls.
- Use `message.author.userId` for Telegram allowlist checks and `message.userKey ?? message.author.userId` for the current memory identity convention.
- Use `thread.post({ markdown })` for Telegram responses.
- Keep webhook routes thin; place behavior in services where it can be tested without live Telegram.
- State tables owned by `@chat-adapter/state-pg` are excluded from Drizzle migrations. Do not add Drizzle ownership for `chat_state_*` tables.

## Environment

Copy package examples before local development:

```sh
cp apps/api/.env.local.example apps/api/.env.local
cp apps/agent/.env.local.example apps/agent/.env.local
```

Important agent env vars:

- `OPENAI_API_KEY` — AI SDK model and embedding calls.
- `DATABASE_URL` — Drizzle app tables and Chat SDK PostgreSQL state.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME` — Telegram adapter config.
- `TELEGRAM_ALLOWED_USER_IDS` — optional comma-separated Telegram numeric user IDs allowed to use the bot. Leave unset to allow all users.
- `BLOOIO_API_KEY`, `BLOOIO_FROM_NUMBER`, `BLOOIO_WEBHOOK_SECRET` — Blooio-backed iMessage adapter config.
- `IMESSAGE_ALLOWED_NUMBERS` — optional comma-separated E.164 phone numbers allowed to use the iMessage agent. Leave unset to allow all numbers.
- `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` — World Cup polling request verification.
- `OPENWEATHER_API_KEY` — weather and local-time tools.

Never commit real secrets or local `.env*` files.

## Testing

Prefer tests around public module boundaries:

- Weather behavior through `WeatherService`.
- World Cup event detection through `WorldCupEventDetector`.
- World Cup subscription matching through `WorldCupSubscriptionService`.
- Memory context behavior through `AgentContextService` and `AgentMemoryService`.

Mock external boundaries: OpenAI/AI SDK calls, Telegram/Chat SDK posting, OpenWeather, World Cup API, QStash, and database services. Database integration tests are gated by `AGENT_DB_INTEGRATION_TESTS=1` and should stay focused on persistence behavior that unit tests cannot prove.

## Code Style

- Preserve existing file and package conventions.
- Prefer explicit domain names over generic helpers.
- Keep expected failures as typed return values where practical.
- Log important state transitions with stable IDs, but avoid logging secrets.
- Avoid adding abstractions until they hide real complexity.
- Use ASCII in source unless a file already uses or needs Unicode.
- Keep React components as function components and maintain existing design language in `apps/web`.

## Before Finishing

Run the narrowest useful verification. For broad changes, prefer:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

If checks cannot be run, state that and explain the residual risk.

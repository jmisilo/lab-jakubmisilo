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
pnpm --filter @labjm/agent db:push
pnpm --filter @labjm/agent eval
```

Use `pnpm` for dependency changes. Do not hand-edit `pnpm-lock.yaml`.

## Architecture

This is a pnpm + Turborepo monorepo. Packages are ESM TypeScript.

- `apps/web` — Next.js site and AI widget UI.
- `apps/api` — Hono API powering the web app.
- `apps/agent` — Mastra + Chat SDK iMessage agent with memory, knowledge, integrations, workflows,
  and scheduling.
- `packages/ai` — AI widget tools and UI message types.
- `packages/schemas` — shared Zod schemas.
- `packages/types` — shared inferred types.
- `packages/utilities` — small shared utilities.
- `packages/eslint-config`, `packages/jest-config`, `packages/typescript-config` — workspace tooling.

## Agent App

The agent is in `apps/agent`.

- Mastra composition: `apps/agent/src/mastra/index.ts`.
- Agent and channel setup: `apps/agent/src/mastra/agents/agent.ts`.
- Product modules: `apps/agent/src/mastra/modules`.
- Knowledge domain: `apps/agent/src/modules/knowledge`.
- Drizzle schema: `apps/agent/src/infrastructure/database`.
- Previous AI SDK implementation: `apps/agent/archive-ai-sdk`.

Keep external systems behind service boundaries. Do not call provider SDKs or database tables directly from unrelated application code.

## Chat SDK Notes

Mastra Channels normalizes platform events and owns thread continuity.

- The Blooio iMessage adapter resolves the canonical resource from `message.author.userId`.
- Keep webhook routes thin and signature-verified.
- Keep attachment limits and normalization in the attachments module.
- Do not use Mastra's in-process scheduler on serverless deployment. Recurring definitions use
  Mastra storage, while QStash owns delivery timing.

## Environment

Copy package examples before local development:

```sh
cp apps/api/.env.local.example apps/api/.env.local
cp apps/agent/.env.example apps/agent/.env
```

Important agent env vars:

- `OPENAI_API_KEY` — AI SDK model and embedding calls.
- `DATABASE_URL` — Mastra PostgreSQL storage and Drizzle app tables.
- `BLOOIO_API_KEY`, `BLOOIO_FROM_NUMBER`, `BLOOIO_WEBHOOK_SECRET` — Blooio-backed iMessage adapter config.
- `AGENT_API_TOKEN` — protects Studio and generic agent API routes.
- `AGENT_RESOURCE_ID` — resource used by Studio/API sessions.
- `AGENT_PUBLIC_URL` — stable public origin used by QStash and Google links.
- `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` — scheduled-task request verification.
- `OPENWEATHER_API_KEY` — weather and local-time tools.

Never commit real secrets or local `.env*` files.

## Testing

Prefer tests around public module and workflow boundaries. Mock OpenAI, Blooio, Google, OpenWeather,
QStash, and database boundaries. Keep normal tests offline; model-backed evaluation belongs in the
separate `eval` command.

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

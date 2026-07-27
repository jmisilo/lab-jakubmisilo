# @labjm/agent

Custom AI agent, built to empower my daily productivity and personal knowledge management. It is an iMessage agent with memory, knowledge, scheduling, nutrition tracking, and Google integration, powered by my own [iMessage SDK](https://imessage-sdk.dev).

## Features

- **Local TUI** — terminal chat UI for testing the agent locally
- **iMessage bot** — Blooio-backed webhook endpoint for direct messages and subscribed threads
- **Memory** — PostgreSQL-backed chat state and agent memory
- **Knowledge** — hierarchical durable notes with hybrid retrieval and atomic corrections
- **Scheduling** — one-time and recurring reminders delivered through QStash
- **Google integration** — Calendar management and strictly read-only Gmail access through one OAuth connection
- **Nutrition tracking** — photo/text meal estimates, explicit confirmation, and daily calorie/macro progress
- **Observability** — Vercel/Pino infrastructure logs and configurable LangSmith agent traces

## How The Agent Works

Request lifecycle:

```mermaid
flowchart LR
  Event[Chat SDK event] --> Gate[allowlist gate]
  Gate --> Bot[BotHandler]
  Bot --> Memory[record message and build context]
  Memory --> Agent[AgentService]
  Agent --> Tools[AI SDK tools]
  Agent --> Reply[thread.post]
  Reply --> After[compression and implicit knowledge]
```

Scheduled-task lifecycle:

```mermaid
flowchart LR
  User[user request] --> Tool[manage-schedule]
  Tool --> Db[(Postgres task metadata)]
  Tool --> QStash[QStash message or cron]
  QStash --> Runner[schedule runner]
  Runner --> Agent[scheduled AgentService call]
  Agent --> Post[post to thread]
  Post --> Finalize[record sent and compare-and-set task state]
```

Core modules:

- `src/app/bot` owns Chat SDK wiring and inbound message handling.
- `src/app/attachments` validates current inbound files and normalizes images for model input.
- `src/app/agent` owns the AI SDK agent, prompt, and tool registry.
- `src/app/memory` owns short-term transcripts, rolling summaries, and context assembly.
- `src/app/knowledge` owns durable tree notes, retrieval, and implicit ingestion.
- `src/app/features/nutrition` owns calorie goals, meal estimation workflows, and daily totals.
- `src/app/schedules` owns schedule creation, cancellation, execution, and recovery.
- `src/archive/world-cup` preserves the disconnected World Cup 2026 implementation and its reconnection guide.
- `src/infrastructure/observability` owns LangSmith tracing, retention controls, and correlation metadata.
- `src/infrastructure/*` wraps provider HTTP clients, DB, QStash, logging, and app errors.

Incoming attachments are ephemeral. The agent accepts up to three files per message, with a 7 MB limit per file. JPEG, PNG, WebP, HEIC, and HEIF images are limited to 40 decoded megapixels, normalized to JPEG within 1536x1536, and stripped of metadata. PDFs, videos, and other files are passed through as current-turn model file inputs. Original attachment bytes are not persisted by the application.

Nutrition estimates follow `photo/text -> draft -> explicit confirmation -> daily totals`. PostgreSQL is the source of truth for goals and confirmed meals; conversational memory is not used as the nutrition ledger. Corrections replace the structured meal estimate, and deletion is soft so totals remain auditable.

Scheduling states:

- Tasks are `active`, `paused`, `completed`, `cancelled`, or `failed`.
- Runs are claimed as `running`, then marked `sent`, `failed`, or `skipped`; an occurrence completed early by the user is marked `satisfied`.
- Recurring active tasks advance `nextRunAt`; one-time active tasks complete after a sent run.
- The runner regenerates same-occurrence edits against the latest revision, skips cancelled or rescheduled occurrences, and fences stale workers with per-attempt claim tokens.
- Post-send reconciliation advances the delivered occurrence without overwriting a newer cancellation or reschedule.
- A satisfied one-time occurrence completes without delivery. A satisfied recurring occurrence skips only that delivery and advances normally when QStash invokes it.
- Paused tasks keep their metadata but have no active QStash trigger until resumed.
- QStash owns delivery timing. Postgres owns task metadata, limits, and cancellation state.

Working conventions:

- Keep provider SDKs and database tables behind infrastructure services.
- Use static service classes for app-owned domain modules, but keep framework edge files simple.
- Put shared schemas/types in nearby `schemas.ts` or `types.ts`; keep file-local helper types below runtime code.
- Prefer changing public module methods and tests over reaching through implementation details.

## Environment

```sh
cp .env.local.example .env.local
```

Fill the provider and integration keys:

- `OPENAI_API_KEY`
- `BLOOIO_API_KEY`
- `BLOOIO_FROM_NUMBER`
- `BLOOIO_WEBHOOK_SECRET`
- `IMESSAGE_ALLOWED_NUMBERS` — optional comma-separated E.164 phone numbers allowed to use the iMessage agent
- `DATABASE_URL`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

LangSmith tracing is optional and disabled locally by default. To enable tracing, set
`LANGSMITH_TRACING=true`, provide `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`, and a base64-encoded
32-byte `AGENT_OBSERVABILITY_HASH_KEY`. These privacy controls default to metadata-only tracing:

```sh
LANGSMITH_ENDPOINT="https://eu.api.smith.langchain.com"
LANGSMITH_HIDE_INPUTS="true"
LANGSMITH_HIDE_OUTPUTS="true"
LANGSMITH_TRACING_SAMPLING_RATE="1"
```

Generate the observability hash key with `openssl rand -base64 32`. LangSmith receives
pseudonymized identities, correlation and runtime metadata, model/tool timing, token usage, and
safe outcomes. Set either hide variable to `false` only when you deliberately want LangSmith to
retain that category of prompts, model outputs, tool inputs, or tool results.
Set `LANGSMITH_WORKSPACE_ID` as well when the LangSmith API key is organization-scoped.

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

Blooio iMessage webhook endpoint:

```txt
POST /webhooks/imessage
```

Configure the Blooio webhook to send signed events to this endpoint. The adapter verifies them
with `BLOOIO_WEBHOOK_SECRET`.

To restrict iMessage access, set `IMESSAGE_ALLOWED_NUMBERS`:

```sh
IMESSAGE_ALLOWED_NUMBERS="+48123456789,+48987654321"
```

Leave it empty to allow all iMessage numbers.

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
- Use the direct/unpooled connection string while applying migrations. If the URL uses
  `sslmode=require`, change it to `sslmode=verify-full` to preserve certificate verification and
  avoid the upcoming `pg` compatibility change.
- Keep all app tables in the `public` schema.
- Do not rely on `search_path` connection options; Neon pooled connections can reject unsupported startup parameters.

Before deploying the app, apply the committed Drizzle migrations to a new database:

```sh
pnpm --filter @labjm/agent db:migrate
```

The initial migration enables `pgvector` before creating the agent tables and vector index.

### 2. Configure Vercel environment variables

Set these in the Vercel project for the environments you deploy to:

Required:

- `DATABASE_URL` — Neon Postgres connection string
- `OPENAI_API_KEY`
- `BLOOIO_API_KEY` — Blooio API key used by the iMessage provider
- `BLOOIO_FROM_NUMBER` — default Blooio sending number in E.164 format
- `BLOOIO_WEBHOOK_SECRET` — verifies signed Blooio webhook deliveries
- `IMESSAGE_ALLOWED_NUMBERS` — optional comma-separated E.164 allowlist while the agent is private
- `OPENWEATHER_API_KEY` — required for weather and local-time tools
- `QSTASH_CURRENT_SIGNING_KEY` — required for QStash-signed scheduled-task execution
- `QSTASH_NEXT_SIGNING_KEY` — required for QStash-signed scheduled-task execution
- `QSTASH_TOKEN` — required for creating QStash one-time messages and recurring schedules
- `AGENT_PUBLIC_URL` — stable public base URL used as the QStash scheduled-task destination, for example `https://agent.example.com`
- `GOOGLE_OAUTH_CLIENT_ID` — Google OAuth web application client id for Calendar and Gmail integration
- `GOOGLE_OAUTH_CLIENT_SECRET` — Google OAuth web application client secret
- `GOOGLE_OAUTH_REDIRECT_URI` — exact Google OAuth redirect URI, for example `https://agent.lab.jakubmisilo.com/links/google/callback`
- `GOOGLE_TOKEN_ENCRYPTION_KEY` — base64-encoded 32-byte key used to encrypt stored Google refresh tokens

Generate the Google token encryption key with:

```sh
openssl rand -base64 32
```

Optional LangSmith observability should use separate configuration for each environment:

- **Development** — tracing stays off locally unless explicitly enabled; use a development project,
  service key, and hash key when needed.
- **Staging** — configure the Vercel Preview scope with a staging project, service key, and hash key.
- **Production** — configure the Vercel Production scope with a production project, service key,
  and hash key.

Set `LANGSMITH_HIDE_INPUTS=true`, and `LANGSMITH_HIDE_OUTPUTS=true` in environments where traces
must remain metadata-only. Do not reuse
`AGENT_OBSERVABILITY_HASH_KEY` between environments; changing it also changes the pseudonymous
identity values used to correlate traces. `LANGSMITH_TRACING_SAMPLING_RATE` accepts a value from
`0` to `1` and can be reduced later if trace volume grows.

Enable both Google Calendar API and Gmail API in the same Google Cloud project. Configure the OAuth consent screen with the Calendar scopes used by the app and `https://www.googleapis.com/auth/gmail.readonly`. Use publishing status `In production` for durable refresh tokens; a personal unverified app will still show Google's warning screen.

Add the optional env vars the same way when those integrations are enabled.

### 3. Deploy

Preferred flow is git-connected Vercel deployment: merge/push to the production branch after the project is linked to Vercel.

Manual CLI deployment:

```sh
vercel --cwd apps/agent deploy --prod
```

### 4. Configure Blooio webhook

Point the Blooio signed webhook at:

```txt
POST https://<agent-domain>/webhooks/imessage
```

The webhook secret must match `BLOOIO_WEBHOOK_SECRET` in Vercel.

### 5. Configure QStash for scheduled tasks

The `manage-schedule` tool creates QStash delayed messages for one-time tasks and QStash schedules for recurring tasks. It does not need a manually configured periodic polling cron. QStash calls:

```txt
POST https://<agent-domain>/jobs/schedules/execute
```

The route verifies QStash signatures with `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.

## Database

Drizzle-managed app tables live in the `public` PostgreSQL schema. The archived `world_cup_2026_*` tables remain managed to preserve historical data; do not drop them merely because the runtime module is disconnected. Schema changes use the checked-in migration workflow:

```sh
pnpm --filter @labjm/agent db:generate
pnpm --filter @labjm/agent db:migrate
```

Review every generated SQL file before committing it. CI migrates a fresh pgvector-enabled PostgreSQL database and runs the gated persistence suites. Chat SDK state tables remain owned by `@chat-adapter/state-pg` and are excluded through `tablesFilter`; do not add Drizzle ownership for `chat_state_*`.

## Stack

- [AI SDK](https://sdk.vercel.ai) — agent runtime and model calls
- [AI SDK TUI](https://sdk.vercel.ai) — local terminal UI
- [Chat SDK](https://www.npmjs.com/package/chat) — iMessage adapter integration and chat state
- [Hono](https://hono.dev) — webhook server
- [Drizzle](https://orm.drizzle.team) — PostgreSQL schema and migrations
- [LangSmith](https://www.langchain.com/langsmith/observability) — agent observability

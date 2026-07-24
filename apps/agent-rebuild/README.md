# agent-rebuild

Mastra-based personal assistant exposed through Mastra Studio and the Blooio-backed Chat SDK
iMessage channel.

## Current Capabilities

- Mastra Observational Memory with resource-scoped continuity and temporal markers
- iMessage through Blooio and direct testing through Mastra Studio
- OpenAI web search
- User-scoped hierarchical knowledge with PostgreSQL and pgvector retrieval
- Native Mastra knowledge-management skill
- LLM-judged response-quality scoring with 10% live sampling
- Recurring Mastra schedules and revision-safe QStash one-time reminders
- Google Calendar plus read-only Gmail through one OAuth connection
- In-memory iMessage images, PDFs, and videos with bounded attachment handling
- Calorie and macronutrient goals, draft meal estimates, and confirmed daily totals
- Current weather, forecasts, local time, and OpenAI web search

Nothing is imported at runtime from the previous `agent` application.

## Local Development

Create `.env` from `.env.example`. `DATABASE_URL` is required for Mastra memory and durable
knowledge. Use the pooled Neon connection URL; its hostname contains `-pooler`.

Studio and generic agent API routes require a token. Set `AGENT_API_TOKEN` in `.env`; in local
development only, the fallback token is `agent-local-dev-token`. Use it on Studio's sign-in screen.
Production has no fallback and refuses to start without `AGENT_API_TOKEN`.

Enable pgvector once in the Neon SQL editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then push the custom knowledge schema:

```sh
pnpm --filter agent-rebuild db:push
```

```sh
pnpm --filter agent-rebuild dev
```

Open `http://localhost:4111`. The iMessage webhook is:

```text
/api/agents/agent/channels/imessage/webhook
```

## Storage

One Neon PostgreSQL database owns both persistence layers:

- Mastra manages threads, messages, resources, observational memory, and framework state in the
  `mastra` schema.
- Drizzle manages the `agent_rebuild_*` knowledge, scheduling, Google, and nutrition tables in
  `public`.

Mastra initializes its own schema when the server starts. Drizzle `db:push` is intentionally limited
to `agent_rebuild_*` tables and does not own Mastra tables.

## Production

Mastra Platform is the default production target. Keep Neon as the external database.

1. Create `.env.production` from `.env.example` and provide production secrets. Set
   `AGENT_PUBLIC_URL` to `https://agent-rebuild.server.mastra.cloud`, `AGENT_RESOURCE_ID` to the
   owner's E.164 phone number, and a strong `AGENT_API_TOKEN`.
2. Push the Drizzle schema against the production `DATABASE_URL`:

```sh
pnpm --filter agent-rebuild db:push
```

3. Deploy from the package:

```sh
pnpm --filter agent-rebuild exec mastra deploy --env production --region eu
```

4. Configure Blooio to send iMessage webhooks to:

```text
https://agent-rebuild.server.mastra.cloud/api/agents/agent/channels/imessage/webhook
```

5. Configure both the Google Cloud OAuth redirect URI and `GOOGLE_OAUTH_REDIRECT_URI` as:

```text
https://agent-rebuild.server.mastra.cloud/links/google/callback
```

The QStash destination is derived from `AGENT_PUBLIC_URL` and points to
`/jobs/schedules/execute`. The route verifies QStash signatures. Google link routes are intentionally
public and protected by short-lived, one-time OAuth state. Studio and generic agent APIs require
`AGENT_API_TOKEN`.

## Evaluation

The response-quality LLM judge is registered in Mastra and scores 10% of live agent responses.
Review its scores and reasons in Studio. It evaluates relevance, naturalness, concision, user focus,
and whether internal metadata stays hidden.

Knowledge regression evaluation is a separate Vitest suite built around Mastra's `runEvals`. It uses
anonymized runtime-shaped cases, enforces score thresholds, creates isolated fixture notes, and
deletes them afterwards:

```sh
pnpm --filter agent-rebuild eval
```

Use `eval:watch` while tuning scorers or datasets. Normal `test` runs remain offline and do not invoke
models. The eval suite requires `OPENAI_API_KEY`, `DATABASE_URL`, pgvector, and the current Drizzle
schema.

## Verification

```sh
pnpm --filter agent-rebuild test
pnpm --filter agent-rebuild exec tsc --noEmit
pnpm --filter agent-rebuild build
```

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
- Prototype recurring Mastra schedules

Google integrations and reliable QStash one-time/recurring scheduling still need fresh implementations
in this app. Nothing is imported from the previous `agent` application.

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
- Drizzle manages `agent_rebuild_*` knowledge-tree tables and pgvector embeddings in `public`.

Mastra initializes its own schema when the server starts. Drizzle `db:push` is intentionally limited
to `agent_rebuild_*` tables and does not own Mastra tables.

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

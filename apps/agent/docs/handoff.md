# Agent Chat Refactor Handoff

Date: 2026-07-05

## Context

The current agent is being moved from a proof-of-concept toward a production-grade personal AI agent. Telegram is the current delivery platform, but the app code should be shaped around the Chat SDK bot interface rather than Telegram-specific orchestration.

The user wants the agent modules shaped around deep modules: small public interfaces, hidden orchestration depth, explicit errors, and no loose helper functions "flying around" application code. Keep this pragmatic: do not split tiny behaviors into standalone services when a single cohesive module is easier to read.

Use `apps/agent/docs/agent-coding-styleguide.md` as the current style reference for reconciling Chat SDK callbacks, AI SDK functions/classes, and app-owned static services.

## Decisions Taken

- Keep Hono as the API handler and keep the Chat SDK entrypoint.
- Keep Telegram behavior such as whitelist gating, typing indicators, transcript appends, response posting, and rolling memory compression.
- Treat `apps/agent/src/app/bot/index.ts` as the Chat SDK bot composition file. It can own multiple platform registrations as long as it remains cohesive.
- Keep SDK construction native: `app/bot/index.ts` creates the `Chat` instance, configures adapters/state, configures `BotHandler`, and registers `.on*` callbacks.
- Put app-owned callback behavior behind `BotHandler`, a static class whose public methods match Chat SDK handler signatures.
- Keep current bot behavior in one cohesive handler for now. Separate `TelegramConversationService` and `TelegramTypingIndicatorService` were removed as over-abstraction.
- Do not wrap the bot factory in a class. Additional platforms should be added by composing Chat SDK adapters/handlers, not by building a framework around Chat SDK.
- Static services may use `this` for private static access. Do not pass those static methods as bare SDK callbacks; use a small callback wrapper that calls the static method through the class.
- Use stable error codes through `AppErrorCode`; do not encode dynamic values into error names/messages such as `assistant_generate_timeout_30000ms`.
- Put timeout values and operation identifiers in structured `context`, not in the error code.
- Use `ErrorService.toUserFacingFailure` and `ErrorService.toSafeLog` for failure projection. The service keeps user-safe messaging and developer log shape in one place without spreading ad-hoc error handling.
- User-facing failures should be safe but useful: include a stable error code and a short retry hint when applicable; keep raw provider/internal details in logs only.
- Keep callback arrows where they are actual callbacks. Prefer function declarations for module-local non-callback behavior.
- If a class is used, use ECMAScript `#` private methods instead of TypeScript `private` methods.
- Keep exported/reusable schemas in the nearest `schemas.ts`; behavior modules such as tools should import schemas instead of defining them inline.
- Use bot-level error codes for generic bot failures:
  - `BOT_EMPTY_RESPONSE`
  - `BOT_MESSAGE_FAILED`
  - `BOT_TYPING_INDICATOR_TIMEOUT`
- For the knowledge MVP, keep the current identity convention: `identityId = message.userKey ?? message.author.userId`. Do not block knowledge work on a separate internal identity resolver.
- Use `db:push` for database shape changes for now. Do not add migrations until the project switches away from the current simple DB workflow.
- Assume PostgreSQL `pgvector` is available. Drizzle in this package supports `vector(...)`, `cosineDistance(...)`, and vector opclasses.
- Model durable knowledge as an arbitrarily deep user-owned tree, not flat collections. A note can naturally become a group when it gains children; group-ness is derived from children rather than stored as a permanent type.
- Use a single knowledge-node table for node content plus a closure table for ancestor/descendant links. This follows the SQL-tree tradeoff discussed in https://dev.to/andreik/trees-in-sql-4fp: parent links are simple but require recursive reads, while auxiliary links make subtree/ancestor reads cheap at the cost of more careful writes.
- Keep closure-table maintenance in the app DB service for MVP, not triggers. This keeps `db:push` simple and keeps tree invariants testable in TypeScript.
- Use Drizzle's `node-postgres` client for app DB access. Knowledge tree writes need real interactive transactions, and the local integration path worked reliably with `pg`.
- The app runs as Vercel Node serverless output, not Edge. The `pg.Pool` approach is acceptable only with serverless pooling hygiene: global pool, low idle timeout, bounded max connections, and `attachDatabasePool(...)`.
- Do not move back to `neon-http` only for serverless aesthetics unless the knowledge write path is redesigned around non-interactive transactions/batches. Interactive Drizzle transactions are the current reason for `node-postgres`.
- Normalize database URLs that use `sslmode=require`, `prefer`, or `verify-ca` to `sslmode=verify-full` before passing them to `pg`. This preserves current `pg` behavior and avoids the pg v9 SSL-mode warning seen against the Neon pooled host.
- Keep old PoC tables out of Drizzle ownership. `agent_noted_memories` is excluded from `db:push`; it has not been manually dropped.
- Build model instructions through `AgentPromptService.buildSystemPrompt(...)`. Keep prompt construction sectioned, typed, and testable instead of storing a large opaque instruction blob.
- Tool descriptions are routing contracts. Use `WHEN TO USE`, `WHEN NOT TO USE`, `DO NOT USE FOR`, `USAGE`, and examples for important tools.

## Done

- Removed the flat noted-memory PoC path in a prior cleanup:
  - `agent_noted_memories` schema/type export removed.
  - `create-noted-memory` tool removed.
  - Context assembly now uses Chat SDK transcripts plus rolling compressed memory chunks only.
- Rewrote the Chat SDK bot setup into a practical composition plus handler split:
  - `app/bot/index.ts` owns Chat SDK construction, Telegram adapter/state configuration, and `.on*` registration.
  - `BotHandler` owns incoming message lifecycle, typing indicator refresh, failure posting, and post-response compression.
- Moved `AIService` to `apps/agent/src/infrastructure/ai`.
- Added `AppError` and `ErrorService` in `apps/agent/src/infrastructure/errors`.
- Migrated agent and AI service timeouts to stable app errors:
  - `ASSISTANT_GENERATE_TIMEOUT`
  - `AI_GENERATE_TIMEOUT`
  - `AI_EMBEDDING_TIMEOUT`
  - `BOT_TYPING_INDICATOR_TIMEOUT`
- Added tests for the error module contract.
- Added a `BotHandler` regression test that calls the public `{ event, thread, message }` handler payload used by Chat SDK registration.
- Moved typing indicator coverage to the full bot handling lifecycle. `BotHandler` now starts typing before transcript/memory writes and keeps refreshing through generation, response posting, and failure handling.
- Migrated weather and World Cup provider failures to stable `AppError` codes:
  - Weather uses `WEATHER_API_TIMEOUT`, `WEATHER_API_ERROR`, `WEATHER_RESPONSE_INVALID`, and `WEATHER_FORECAST_TARGET_UNAVAILABLE`.
  - World Cup API uses `WORLD_CUP_API_TIMEOUT` and `WORLD_CUP_API_ERROR`.
  - World Cup catch boundaries now log `ErrorService.toSafeLog(error)` for coded app errors.
- Moved tool input/output/context schemas out of tool modules:
  - Weather tool schemas now live in `features/weather/schemas.ts`.
  - World Cup tool schemas now live in `features/world-cup/schemas.ts`.
- Added the first durable knowledge-system slice:
  - `agent_knowledge_nodes` stores an arbitrarily deep user-owned note tree with markdown content, active/superseded metadata, source metadata, and pgvector embeddings.
  - `agent_knowledge_node_closure` stores ancestor/descendant links for cheap ancestor, child, and sibling expansion around vector matches.
  - `AgentKnowledgeDbService` owns tree/path/closure persistence and vector retrieval. Create-node writes use app-generated IDs plus an interactive transaction to insert the node and closure rows atomically.
  - `AgentKnowledgeService` owns embedding generation through `AIService`, retrieval text construction from recent transcript messages, safe retrieval degradation, and context item formatting.
  - `AgentContextService` now retrieves durable knowledge under a 20% context budget and includes it before compressed rolling memory.
- Applied the knowledge schema with `pnpm --filter=agent db:push` after user execution and verified these DB tables/indexes exist:
  - `agent_knowledge_nodes`
  - `agent_knowledge_node_closure`
  - pgvector index on knowledge-node embeddings
- Added an opt-in DB integration test for `AgentKnowledgeDbService`. It is skipped by default and runs when `AGENT_DB_INTEGRATION_TESTS=1`.
- Added `manage-knowledge` as a constrained AI SDK tool:
  - `create` saves explicit durable notes.
  - `update` rewrites an active note by path.
  - `supersede` marks old active facts inactive while optionally creating or linking a replacement note.
- Updated the agent instruction so explicit remember/save/note/update/correct/no-longer-active requests use `manage-knowledge`.
- Added post-response implicit knowledge extraction:
  - `BotHandler` schedules it with `waitUntil(...)` after a successful assistant response.
  - `AgentKnowledgeService.extractImplicitKnowledge(...)` asks the model for strict JSON, validates the schema, filters low-confidence items, embeds accepted notes, and stores them as `source: 'implicit'`.
  - Extraction failures are logged and do not block user responses.
- Added tests for knowledge retrieval, explicit management, implicit extraction, and bot-level scheduling of implicit extraction.
- Tuned the DB client for serverless:
  - `pg.Pool` is still used for local compatibility and Drizzle interactive transactions.
  - Pool size is bounded, idle timeout is short, connection timeout is explicit, and `attachDatabasePool(dbPool)` is called after pool creation.
  - SSL mode aliases are normalized to `verify-full` before pool creation.
- Replaced the flat `app/instruction.ts` prompt with `AgentPromptService`:
  - Prompt sections now cover identity, runtime context, agency, communication, context/memory, knowledge use, tool routing, ambiguity/defaults, and side effects.
  - `AgentService.prepareCall(...)` now injects call-specific identity, current date, timezone, and active tool names into the instructions.
- Tuned model-facing tool descriptions for:
  - `manage-knowledge`
  - `get-weather`
  - `get-local-time`
  - `manage-world-cup-subscription`
  - `get-world-cup-tracking`
  - `get-world-cup-context`
- Added prompt-service tests for sectioned runtime prompt output and durable-knowledge examples.
- Added production diagnostics around `manage-knowledge`:
  - Each tool call gets an `operationId` that is logged and returned in tool output.
  - Start/success/rejected-input/failure logs include `identityId`, `sourceMessageId`, action, path fields, note title, content length, and content hash.
  - Full attempted content is not logged by default. Temporarily set `AGENT_LOG_KNOWLEDGE_TOOL_CONTENT=1` to include a capped content preview in logs while debugging a production save failure.
- Fixed the first production `manage-knowledge` save failure mode:
  - Creating a note under a missing `parentPath` now auto-creates the missing group path segments as `source: "system"` structural nodes.
  - `manage-knowledge` input is now a discriminated union per action, so create/update/supersede payloads do not mix irrelevant fields after schema parsing.
  - Implicit extraction accepts `parentPath: null` and normalizes it to `undefined`.
- Tuned knowledge retrieval:
  - Vector retrieval now uses top 3 active matches by default.
  - Matches below similarity `0.35` are filtered out before ancestor/child/sibling tree expansion.
  - Tree expansion is still local around the selected matches, not a recursive subtree dump.
- Tuned implicit ingestion instructions so important durable user facts such as nationality, age, gender, default/native location, language, preferences, work, relationships, and project facts are captured more frequently.

## Current Module Shape

- `apps/agent/src/index.ts` wires Hono routes and delegates Telegram webhook handling to `bot.webhooks.telegram`.
- `apps/agent/src/app/bot/index.ts` exports the configured Chat SDK bot and registers the current Chat SDK handlers.
- `apps/agent/src/app/bot/bot-handler.ts` exports `BotHandler`, the static app-owned interface used by Chat SDK callbacks.
- `apps/agent/src/app/agent/prompt.ts` exports `AgentPromptService`, the pure prompt-construction boundary for the ToolLoopAgent.
- `apps/agent/src/app/knowledge/index.ts` exports `AgentKnowledgeService`, the application boundary for durable knowledge.
- `apps/agent/src/infrastructure/ai/index.ts` owns AI SDK `generateText` and `embed` calls.
- `apps/agent/src/infrastructure/db/services/agent-knowledge.ts` owns Drizzle persistence and retrieval for knowledge nodes.
- `apps/agent/src/infrastructure/errors/index.ts` owns stable app errors plus `ErrorService` user-facing and log-safe projections.

## Next Work

- Decide whether to add a revision/history table before building update-heavy tools. The current schema preserves superseded nodes but does not store every content edit revision.
- Add duplicate/merge protection for implicit extraction later. Current implicit extraction can create a new note every time a similar fact appears; the future slice should retrieve nearby candidates first and choose create/update/supersede deterministically.
- Add path-aware implicit extraction context later. The extractor currently prefers root-level notes unless a path is obvious from the turn; it should eventually receive likely existing paths from retrieval so it can place notes under the right parent.
- Add read/list/debug tooling for durable knowledge. The agent can write and retrieve knowledge, but there is no admin/TUI path yet to inspect or correct the tree.
- Add a deployment/runtime smoke check for the serverless DB pool after the next Vercel deployment. Code-level validation is done, but pool behavior under real Fluid Compute/serverless concurrency still needs production evidence.
- Consider a single app-owned DB adapter factory if another runtime needs different DB connection behavior. Do not introduce it until the second runtime exists.
- Decide whether to manually drop legacy `agent_noted_memories` after confirming no environment still depends on it.
- Revisit retrieval ranking with real conversations. The current expansion includes matches, ancestors, children, and siblings; it may need thresholds, per-relationship budgets, or path-based boosts after usage data.
- If another chat platform appears, register it through `app/bot/index.ts` first; split platform-specific modules only when behavior differs enough to justify it.
- Add behavior tests around multi-platform bot registration once a second platform exists.

## Verification

These checks passed after the latest knowledge-system slice:

```sh
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent test
pnpm --filter @labjm/agent build
```

The opt-in DB integration test also passed against the configured database:

```sh
AGENT_DB_INTEGRATION_TESTS=1 pnpm --filter @labjm/agent test -- agent-knowledge.integration.test.ts
```

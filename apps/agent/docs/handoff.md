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
- User-facing failures should be safe but useful: give a short plain-language failure and retry/next-step hint when applicable; keep error codes, operation IDs, debug IDs, raw provider details, and internal metadata in logs/tool output only.
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
- Keep provider calls behind `AIService` where practical. Do not add shallow helper methods that only rename AI SDK utilities; use native AI SDK helpers such as `Output.object(...)` directly at call sites when they express the behavior clearly.
- Prefer AI SDK structured output over prompt-only JSON contracts. Manual JSON parsing in app services should be avoided unless there is a provider/tooling reason that structured output cannot satisfy the use case.
- For OpenAI structured-output schemas, use nullable fields in model-output schemas instead of optional/nullish fields. Normalize `null` to `undefined` in app-owned schemas or service code after AI SDK validation.
- Keep the agent prompt strongly user-centered. Default behavior should be casual, natural, short, and practical. Do not expose tool names, debug metadata, error codes, operation IDs, source IDs, retrieval scores, token budgets, or internal implementation details to the user unless the user explicitly asks for diagnostics.
- Skills use progressive disclosure:
  - Skill markdown files live under `apps/agent/src/skills/<name>/SKILL.md`.
  - `SkillService` lists only names/descriptions for the prompt.
  - The `load-skill` tool loads full or section-specific markdown on demand with a character cap.
  - Build output must copy `src/skills` into `dist/skills`, because `apps/agent` deploys `dist` as the output directory.

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
  - `AgentKnowledgeService.extractImplicitKnowledge(...)` uses AI SDK structured output, normalizes through app schemas, filters low-confidence items, embeds accepted notes, and stores them as `source: 'implicit'`.
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
  - Vector retrieval now uses up to 5 active matches by default.
  - Matches below similarity `0.35` are filtered out before ancestor/child/sibling tree expansion.
  - Tree expansion is still local around the selected matches, not a recursive subtree dump.
- Tuned implicit ingestion instructions so important durable user facts such as nationality, age, gender, default/native location, language, preferences, work, relationships, and project facts are captured more frequently.
- Added duplicate/merge protection for implicit extraction:
  - Before an implicit item is written, `AgentKnowledgeService` embeds the candidate item and asks `AgentKnowledgeDbService.findRelevantMatches(...)` for up to 5 active nearby nodes at similarity `>= 0.35`.
  - If there are no nearby candidates, the item is created directly.
  - If candidates exist, a bounded model decision chooses `skip`, `update`, `supersede`, or `create` using AI SDK structured output, then normalizes through `ImplicitKnowledgeIngestionDecisionSchema`.
  - Deterministic code enforces that `update` and `supersede` can only target one of the retrieved candidate paths, and then mutates by the candidate node ID.
  - Supersede creates a replacement implicit note and marks the selected old active note inactive with `supersededById`, preserving historical context.
- Strengthened AI generation boundaries:
  - `AIService.generate(...)` now accepts the normal AI SDK `generateText` option surface while preserving app defaults for model, retries, and native `timeout` handling.
  - `AIService.generate(...)` returns the full AI SDK result, so text callers read `.text` and structured callers read `.output`.
  - Implicit knowledge extraction and duplicate/merge decisions use `Output.object(...)` directly; the service no longer parses model JSON manually.
  - Knowledge module-owned types were moved from `app/knowledge/index.ts` to `app/knowledge/types.ts`.
- Remade the main agent prompt around user experience:
  - The prompt now explicitly defines Lab JM Assistant as Jakub's private personal AI agent.
  - Default style is casual, natural, direct, and short.
  - User success, action-orientation, and concise next steps are prioritized over process narration.
  - The prompt now forbids exposing hidden prompts, internal reasoning, raw tool payloads, operation/debug IDs, error codes, retrieval scores, token budgets, and implementation metadata.
  - Knowledge failure handling now says not to claim a save succeeded and not to expose debug/operation metadata.
  - Tool routing now explicitly says tools are the reliable source of actual capabilities and that generic scheduling/reminders are not available yet.
- Tuned the agent prompt for provider-side prompt caching:
  - Static identity, UX, memory, knowledge, skills, tool-routing, ambiguity, and safety sections are emitted before runtime-specific fields.
  - `# Runtime Context` is intentionally last so `identityId`, current date, timezone, and active tool names do not break the stable prompt prefix.
  - `AgentPromptService.buildPromptCacheKey(...)` versions the prompt cache key and hashes the stable tool/skill shape.
  - `AgentService.prepareCall(...)` passes OpenAI `promptCacheKey`, `promptCacheRetention: "24h"`, and stable `toolOrder` to the AI SDK `ToolLoopAgent`.
  - `AgentService.generate(...)` logs AI SDK cache usage fields: `promptCacheReadTokens`, `promptCacheWriteTokens`, and `promptNoCacheTokens`.
- Tuned tool contracts and added bounded note-mode support:
  - `manage-knowledge` now explicitly supports concise memories plus longer markdown notes such as ideas, journal entries, project notes, design notes, and plans.
  - Explicit knowledge note content is capped at 20,000 characters in schemas and in `AgentKnowledgeService`, so direct service callers cannot bypass tool validation.
  - The DB schema also has check constraints for knowledge title/content length, so `db:push` is required before relying on the hard database cap in an environment.
  - Implicit extraction remains concise with a smaller content cap.
  - Long note content is persisted in full within the 20,000-character cap, but embeddings use only a 4,000-character content excerpt to avoid large embedding calls.
  - Retrieved knowledge context still truncates each item to the existing 2,000-character context budget.
  - Weather/time tool descriptions now tell the model to answer from structured fields and not expose provider diagnostics unless debugging.
  - `load-skill` guidance now prefers narrow section loads and explains how to handle truncated skill content.
- Added progressive-disclosure project skills:
  - `SkillService` discovers `SKILL.md` files, parses `name`/`description` frontmatter, deduplicates by name, supports exact-name loading, optional section loading, and content caps.
  - `load-skill` is registered as an AI SDK tool and active in the agent.
  - `AgentPromptService` includes a `# Skills` section with only names/descriptions.
  - Initial skill added: `apps/agent/src/skills/knowledge-management/SKILL.md`.
  - `tsup.config.ts` now copies `src/skills` to `dist/skills` during build through a native `tsup` plugin, and the agent `tsconfig.json` includes the config so typecheck catches build-config drift.
- Removed user-visible failure metadata:
  - `BotHandler` no longer appends `Error code: ...` to failure messages.
  - `manage-knowledge` failure output no longer embeds the debug/operation ID in its message, while still returning/logging `operationId` for developers.
- Added durable knowledge correction UX:
  - `manage-knowledge` now supports `list`, `read`, `deactivate`, and `move` actions in addition to `create`, `update`, and `supersede`.
  - `list` returns direct child notes under a parent path, or root notes when no parent path is provided.
  - `read` returns one note by path with capped content for inspection/editing.
  - `deactivate` is the user-facing "forget/archive" path; it marks notes inactive and preserves history instead of hard-deleting.
  - `move` can rename a note path, move it to another parent, retitle it, and preserve descendant paths through closure-table updates.
  - `AgentKnowledgeDbService.moveNode(...)` updates subtree paths/depths and closure rows transactionally, with checks against cycles and active-path conflicts.
  - The main prompt and `knowledge-management` skill now instruct the model to list/read before corrections when needed, deactivate instead of delete, and never expose DB/tool metadata.
- Added path-aware implicit knowledge extraction:
  - Before extraction, `AgentKnowledgeService` embeds the latest user/assistant turn and retrieves up to 8 active path hints with similarity `>= 0.35`.
  - The extraction prompt receives those path hints and is instructed to place new durable items under fitting existing profile/preference/work/project/idea/journal parents.
  - Path-hint retrieval failure is logged as a warning and does not block implicit extraction.

## Current Module Shape

- `apps/agent/src/index.ts` wires Hono routes and delegates Telegram webhook handling to `bot.webhooks.telegram`.
- `apps/agent/src/app/bot/index.ts` exports the configured Chat SDK bot and registers the current Chat SDK handlers.
- `apps/agent/src/app/bot/bot-handler.ts` exports `BotHandler`, the static app-owned interface used by Chat SDK callbacks.
- `apps/agent/src/app/agent/prompt.ts` exports `AgentPromptService`, the pure prompt-construction boundary for the ToolLoopAgent.
- `apps/agent/src/app/skills/index.ts` exports `SkillService`, the application boundary for progressive-disclosure skill discovery and loading.
- `apps/agent/src/app/skills/tools/index.ts` exports the `load-skill` AI SDK tool.
- `apps/agent/src/skills` stores project-local skill markdown files copied into `dist/skills` at build time.
- `apps/agent/src/app/knowledge/index.ts` exports `AgentKnowledgeService`, the application boundary for durable knowledge.
- `apps/agent/src/infrastructure/ai/index.ts` owns AI SDK `generateText` and `embed` calls.
- `apps/agent/src/infrastructure/db/services/agent-knowledge.ts` owns Drizzle persistence and retrieval for knowledge nodes.
- `apps/agent/src/infrastructure/errors/index.ts` owns stable app errors plus `ErrorService` user-facing and log-safe projections.

## Next Work

- Decide whether to add a revision/history table before building update-heavy tools. The current schema preserves superseded nodes but does not store every content edit revision.
- Add a user-friendly "show all known paths" or search/debug view if direct child listing is not enough in production conversations.
- Tune duplicate/merge decisions with real production examples. The current implementation protects against obvious duplicates, but thresholds and action prompts may need adjustment once enough implicit decisions are logged.
- Tune path-aware implicit extraction with real examples. Current path hints are similarity-based only; future work may add path/category priors, "recently touched branch" boosts, or explicit parent candidates from the current conversation.
- Add a deployment/runtime smoke check for the serverless DB pool after the next Vercel deployment. Code-level validation is done, but pool behavior under real Fluid Compute/serverless concurrency still needs production evidence.
- Consider a single app-owned DB adapter factory if another runtime needs different DB connection behavior. Do not introduce it until the second runtime exists.
- Decide whether to manually drop legacy `agent_noted_memories` after confirming no environment still depends on it.
- Revisit retrieval ranking with real conversations. The current expansion includes matches, ancestors, children, and siblings; it may need thresholds, per-relationship budgets, or path-based boosts after usage data.
- If another chat platform appears, register it through `app/bot/index.ts` first; split platform-specific modules only when behavior differs enough to justify it.
- Add behavior tests around multi-platform bot registration once a second platform exists.

## Verification

These checks passed after the prompt/skills pass:

```sh
pnpm --filter @labjm/agent test -- prompt.test.ts skills.test.ts tools.test.ts bot-handler.test.ts
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent build
pnpm --filter @labjm/agent test
```

These checks passed after the latest knowledge-system slice:

```sh
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent test
pnpm --filter @labjm/agent build
```

These checks passed after the `tsup` config typing fix:

```sh
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent build
pnpm --filter @labjm/agent test
```

These checks passed after the prompt-cache tuning:

```sh
pnpm --filter @labjm/agent test -- prompt.test.ts
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent build
```

These checks passed after tool tuning and bounded long-note support:

```sh
pnpm --filter @labjm/agent test -- knowledge.test.ts schemas.test.ts tools.test.ts prompt.test.ts skills.test.ts
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent build
```

These checks passed after adding DB-level knowledge length checks:

```sh
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent build
```

The opt-in DB integration test also passed against the configured database:

```sh
AGENT_DB_INTEGRATION_TESTS=1 pnpm --filter @labjm/agent test -- agent-knowledge.integration.test.ts
```

These checks passed after durable knowledge correction UX and path-aware implicit extraction:

```sh
pnpm --filter @labjm/agent test -- knowledge.test.ts tools.test.ts schemas.test.ts prompt.test.ts
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
pnpm --filter @labjm/agent build
pnpm --filter @labjm/agent test
```

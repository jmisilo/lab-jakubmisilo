# Agent Chat Refactor Handoff

Date: 2026-07-04

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

## Current Module Shape

- `apps/agent/src/index.ts` wires Hono routes and delegates Telegram webhook handling to `bot.webhooks.telegram`.
- `apps/agent/src/app/bot/index.ts` exports the configured Chat SDK bot and registers the current Chat SDK handlers.
- `apps/agent/src/app/bot/bot-handler.ts` exports `BotHandler`, the static app-owned interface used by Chat SDK callbacks.
- `apps/agent/src/infrastructure/ai/index.ts` owns AI SDK `generateText` and `embed` calls.
- `apps/agent/src/infrastructure/errors/index.ts` owns stable app errors plus `ErrorService` user-facing and log-safe projections.

## Next Work

- Add internal user identity resolution and stop using Telegram `author.userId` as the core identity.
- Build the new durable knowledge module as an arbitrarily deep user-owned node tree. Do not revive flat noted memories.
- Add `manage-knowledge` as a constrained tool once the knowledge module exists.
- If another chat platform appears, register it through `app/bot/index.ts` first; split platform-specific modules only when behavior differs enough to justify it.
- Add behavior tests around `BotHandler` once identity and knowledge dependencies stabilize.

## Verification

These checks passed after the latest bot/styleguide update:

```sh
pnpm --filter @labjm/agent test
pnpm --filter @labjm/agent typecheck
pnpm --filter @labjm/agent lint
```

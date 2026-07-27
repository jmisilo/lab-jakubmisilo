# Agent Coding Styleguide

Date: 2026-07-03

## Goal

Use one consistent project style without fighting the shape of external SDKs.

The rule is:

> App-owned capabilities use static service classes. Framework and SDK setup keeps its native shape, then delegates behavior into app-owned static interfaces.

This gives consistency where we own behavior, while avoiding wrapper frameworks around Chat SDK, AI SDK, Hono, or other libraries.

## Module Shapes

### 1. App-Owned Capabilities

Use static service classes for domain/application capabilities that hide real behavior.

Examples:

- `AgentMemoryService`
- `AgentContextService`
- `AIService`
- `WeatherService`
- `AgentScheduleService`
- `ErrorService`

Rules:

- Public methods should describe outcomes, not mechanics.
- Keep vendor details, SQL details, ranking logic, retries, timeout construction, and formatting behind the service.
- Use `#` private methods for private class internals. Do not use TypeScript `private`.
- Do not create a service if it only wraps one call and adds no policy.

Good:

```ts
await AgentMemoryService.buildContext({ identityId, threadId, shortTermMemory });
```

Weak:

```ts
await AgentMemoryService.formatChunksAndJoinStrings(...);
```

### 2. Framework And SDK Edges

Keep external library shapes where they naturally belong, but wrap app behavior behind stable project interfaces.

Examples:

- Chat SDK uses `new Chat(...)` and `.onDirectMessage(...)` callbacks.
- Hono uses route chaining.
- AI SDK exposes functions such as `generateText`, `embed`, and `tool`.
- AI SDK also exposes useful classes such as `ToolLoopAgent`.

Do not wrap SDK primitives only for aesthetics. A wrapper is justified when it hides policy, normalizes errors, centralizes configuration, or creates a stable app interface.

Good:

```ts
bot.onDirectMessage(
  withWhitelist('direct_message', (thread, message, event) =>
    BotHandler.respondToMessage({ event, thread, message }),
  ),
);
```

Weak:

```ts
class TelegramAgentBot {
  static create() {
    return new Chat({ ... });
  }
}
```

### 3. Bot Composition

`apps/agent/src/app/bot/index.ts` is the Chat SDK bot composition file.

For the MVP, it may directly:

- create the `Chat` instance;
- configure adapters and state;
- register `.on*` handlers;
- configure app-owned handlers.

This is not "Telegram implementation leakage" as long as the file remains about Chat SDK bot composition. If more platforms arrive, add them as additional adapter/handler registrations or split only when the file loses locality.

Preferred shape:

```ts
export const bot = new Chat({ ... });

BotHandler.configure({ bot });

bot.onDirectMessage(
  withWhitelist('direct_message', (thread, message, event) =>
    BotHandler.respondToMessage({ event, thread, message }),
  ),
);
bot.onNewMention(
  withWhitelist('new_mention', (thread, message, event) =>
    BotHandler.respondToMessage({ event, thread, message }),
  ),
);
```

Rules:

- `BotHandler` owns the chat message lifecycle: transcript writes, memory writes, context assembly, agent generation, response posting, failure posting, and post-response maintenance.
- `withWhitelist(event, callback)` passes the same `event` value to the callback as the third argument; forward it into `BotHandler.respondToMessage({ event, thread, message })`.
- Static service methods may use `this` for private static access and static state.
- Do not pass static methods as bare SDK callbacks when they use `this`; use a small callback wrapper that calls the static method through the class.
- Keep callback registration short and declarative.
- Do not introduce `TelegramAgentBot` or `ChatAgentBot` classes for composition.
- Split into `bot/telegram.ts`, `bot/slack.ts`, etc. only when platform-specific behavior becomes large enough to deserve its own module.

### 4. AI SDK Runtime

Use SDK shapes directly, then hide project policy behind app services.

Recommended:

- `AgentService` owns the configured `ToolLoopAgent`.
- `AIService` in `src/infrastructure/ai` owns direct `generateText` and `embed` calls.
- Tool definitions are exported constants created with `tool({ ... })`.
- Tool `execute` callbacks should delegate to app services for business behavior.

Rules:

- Do not create wrapper classes around `tool(...)` definitions.
- Do not let tool callbacks reach into database tables directly.
- Keep model ids, timeout policy, retry policy, tool activation, and error normalization in app-owned services.

### 5. Infrastructure And Provider Access

External systems should sit behind scoped service/adapters.

Examples:

- `GoogleCalendarApiClient` owns Google Calendar API calls.
- `AgentMemoryDbService` owns agent memory table access.
- `WeatherService` owns OpenWeather behavior.

Rules:

- Do not call provider SDKs or database tables from unrelated application code.
- Keep provider response normalization near the provider boundary.
- Use stable app errors where provider failures need to cross module boundaries.

### 6. Schemas

Keep exported schemas in the nearest `schemas.ts` owned by the feature/module.

Rules:

- Do not define reusable or exported Zod schemas inside behavior modules such as tool files, services, handlers, or routes.
- Tool input/output schemas belong in the nearest feature `schemas.ts` unless they are truly private and one-off.
- Behavior modules should import schemas and focus on orchestration/execution.
- Keep schema-derived types near the caller when they describe the caller's SDK shape, such as `Tool<z.infer<...>>`.

### 7. Error Handling

Use `AppError` for expected application failures that need stable codes or user-safe messages.

Use `ErrorService` for:

- converting unknown errors into safe user-facing failures;
- creating log-safe error context.

Rules:

- Error codes are stable strings, not dynamic messages.
- Put values such as timeout duration, model id, provider status, thread id, and message id in `context`.
- User-facing messages should be safe and actionable.
- Logs should include stable ids and safe error context.
- Raw provider/internal details should not be sent to the user.

### 8. Function Declarations Vs Static Methods

Use function declarations for module-local implementation details at framework edges.

Use static methods for app-owned service interfaces.

Use arrow functions for callbacks passed to SDKs/frameworks.

Avoid:

- exported loose helpers in broad utility folders;
- module-level arrow functions for non-callback behavior;
- classes that only wrap SDK construction for aesthetic consistency.

## When To Split A File

Split only when there are separate reasons to change.

Split when:

- a platform has large platform-specific behavior;
- a capability needs independent tests through a public interface;
- an external system boundary needs isolation;
- a file mixes unrelated domains.

Do not split when:

- the helper is only used by one nearby function;
- the split would create a shallow wrapper;
- the goal is only to make every file look like a service class.

## Current Direction

Near-term preferred shape:

- Keep `app/bot/index.ts` as Chat SDK bot composition.
- Keep `BotHandler` as the app-owned static interface for Chat SDK message callbacks.
- Keep app capabilities in static services.
- Keep AI SDK tools as `tool(...)` constants that delegate to services.
- Keep AI provider calls under `src/infrastructure/ai`.
- Keep stable app errors under `src/infrastructure/errors`.
- Revisit platform splitting only when a second real platform forces different behavior.

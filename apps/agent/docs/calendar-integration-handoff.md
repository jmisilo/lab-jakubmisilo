# Google Calendar Integration Handoff

Date: 2026-07-07

## Goal

Add Google Calendar integration to the Telegram agent so the user can connect a Google account from chat, then let the agent read and manage calendar events.

Target user flow:

1. User asks the assistant to connect Google Calendar.
2. Assistant sends a connection link under `https://agent.lab.jakubmisilo.com/links/...`.
3. User opens the link, authenticates with Google, grants Calendar access, and returns to the bot.
4. Agent can list calendars/events and create/update/delete events, including attendees and Google Meet links.
5. Agent can also use Calendar tools during scheduled-task execution, with stricter mutation limits described below.

## Product Decisions

- Use the existing agent Hono app for v1 link handling. Do not create a separate `links` app yet.
- Public link shape should be under `agent.lab.jakubmisilo.com/links/...`, for example `/links/google-calendar/connect/:requestId`.
- Support all writable calendars when practical. If calendar discovery is unavailable or ambiguous, fall back to the primary calendar.
- Support attendees in v1.
- Support Google Meet link creation in v1.
- Scheduled tasks may use Calendar tools. Start by allowing read and create in scheduled mode; keep update/delete chat-only unless a later confirmation model is designed.
- Use `https://www.googleapis.com/auth/calendar.events` plus `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
- Google app verification/consent-screen requirements are known and will be handled separately.

## Existing Architecture Context

Relevant current files:

- `apps/agent/src/index.ts` composes Hono routers and Telegram webhook handling.
- `apps/agent/src/app/agent/index.ts` owns AI SDK `ToolLoopAgent` configuration, active tool selection, and tool context.
- `apps/agent/src/app/agent/tools.ts` is the tool registry.
- `apps/agent/src/app/bot/bot-handler.ts` owns message lifecycle, transcript writes, memory writes, model calls, response posting, and post-response maintenance.
- `apps/agent/src/infrastructure/db/schema.ts` owns Drizzle app tables.
- `apps/agent/src/infrastructure/db/services/*` owns database access.
- External systems are already isolated behind app services or infrastructure adapters. Preserve this pattern.

Do not call Google APIs, Telegram APIs, or Drizzle tables directly from tool callbacks or unrelated application code.

## Recommended Module Shape

Add a feature module:

```txt
apps/agent/src/app/features/google-calendar/
  index.ts                  # Hono router for /links/google-calendar/*
  schemas.ts                # OAuth route schemas and tool schemas
  tools/index.ts            # AI SDK tools; delegates to services
  connection/index.ts       # GoogleCalendarConnectionService
  events/index.ts           # GoogleCalendarEventService
  types.ts                  # feature-owned domain types
```

Add infrastructure boundaries:

```txt
apps/agent/src/infrastructure/google/
  oauth.ts                  # GoogleOAuthService: auth URLs, token exchange, refresh, revoke
  calendar.ts               # GoogleCalendarApiClient: calendar/event API calls
  token-crypto.ts           # TokenEncryptionService, if not kept private to OAuth service
```

Add DB service:

```txt
apps/agent/src/infrastructure/db/services/google-calendar.ts
```

Add type exports if needed:

```txt
apps/agent/src/types/google-calendar-connection.ts
apps/agent/src/types/google-calendar-oauth-state.ts
apps/agent/src/types/google-calendar-action-audit.ts
```

Keep public interfaces small and domain-oriented. Good examples:

- `GoogleCalendarConnectionService.createConnectionRequest(...)`
- `GoogleCalendarConnectionService.completeConnection(...)`
- `GoogleCalendarConnectionService.disconnect(...)`
- `GoogleCalendarEventService.listEvents(...)`
- `GoogleCalendarEventService.createEvent(...)`
- `GoogleCalendarEventService.updateEvent(...)`
- `GoogleCalendarEventService.deleteEvent(...)`

Avoid interfaces that expose Google SDK objects, raw token responses, SQL rows, auth headers, or OAuth mechanics to callers.

## Hono Route Plan

Mount a router from `apps/agent/src/index.ts`:

```ts
.route('/', GoogleCalendarRouter)
```

Route sketch:

```txt
GET /links/google-calendar/connect/:requestId
GET /links/google-calendar/callback
GET /links/google-calendar/done
GET /links/google-calendar/error
```

`GET /links/google-calendar/connect/:requestId`:

- Look up a pending connection request by `requestId`.
- Verify it is not expired and not consumed.
- Generate a Google authorization URL with:
  - `client_id`
  - exact `redirect_uri`
  - requested scopes
  - `access_type=offline`
  - `include_granted_scopes=true`
  - `prompt=consent` when a fresh refresh token is required
  - opaque `state`
- Redirect to Google.

`GET /links/google-calendar/callback`:

- Validate `state`.
- Reject expired, missing, already consumed, or mismatched states.
- Handle `error=access_denied` safely.
- Exchange `code` for tokens.
- Verify required scopes were granted.
- Store encrypted refresh token and connection metadata.
- Mark state consumed.
- Call `bot.initialize()` before posting outside the Telegram webhook lifecycle.
- Post a short confirmation to the originating thread.
- Redirect to a simple success page.

For v1, these routes can return minimal HTML strings through Hono. No React or Next UI is required.

## OAuth And Google API Requirements

Google docs to verify during implementation:

- Web-server OAuth flow: `https://developers.google.com/identity/protocols/oauth2/web-server`
- OAuth scopes: `https://developers.google.com/identity/protocols/oauth2/scopes`
- Calendar event methods: `https://developers.google.com/workspace/calendar/api/v3/reference/events`
- Calendar list method: `https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list`

Important requirements from the docs:

- Use a web application OAuth client with exact authorized redirect URIs.
- Use `state` to protect against CSRF.
- Use `access_type=offline` to receive a refresh token.
- Store refresh tokens in secure long-lived storage.
- Refresh access tokens using the refresh token.
- Revoke tokens on disconnect through Google's revocation endpoint.
- Use HTTPS redirect URIs for production.
- Request only necessary scopes.

Required environment variables:

```txt
GOOGLE_OAUTH_CLIENT_ID=""
GOOGLE_OAUTH_CLIENT_SECRET=""
GOOGLE_OAUTH_REDIRECT_URI="https://agent.lab.jakubmisilo.com/links/google-calendar/callback"
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=""
```

Add these to `turbo.json` `globalEnv`, `apps/agent/.env.local.example`, and deployment docs when implementing.

## Scopes

Use:

```txt
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.calendarlist.readonly
```

Rationale:

- `calendar.events` is sufficient for event CRUD without broad calendar ACL/share management.
- `calendar.calendarlist.readonly` lets the agent discover calendars and identify writable calendars.
- Avoid broad `https://www.googleapis.com/auth/calendar` unless a later requirement needs full calendar management.

Optional if the connected Google account email should be shown in status:

```txt
openid
email
```

If not using OpenID/email, connection status can say "Google Calendar is connected" without showing the account email.

## Database Plan

Add `agent_google_calendar_oauth_states`:

- `id uuid primary key defaultRandom()`
- `requestId text not null unique`
- `stateHash text not null unique`
- `identityId text not null`
- `threadId text not null`
- `sourceMessageId text`
- `scopes text[] not null`
- `redirectPath text`
- `expiresAt timestamp with time zone not null`
- `consumedAt timestamp with time zone`
- `createdAt timestamp with time zone not null defaultNow()`

Add indexes:

- `stateHash`
- `requestId`
- `(identityId, threadId, expiresAt)`

Add `agent_google_calendar_connections`:

- `id uuid primary key defaultRandom()`
- `identityId text not null`
- `status text enum ['active', 'revoked', 'invalid'] not null default 'active'`
- `googleAccountEmail text`
- `encryptedRefreshToken text not null`
- `refreshTokenIv text not null`
- `refreshTokenAuthTag text not null`
- `grantedScopes text[] not null`
- `defaultCalendarId text`
- `metadata jsonb not null default {}`
- `connectedAt timestamp with time zone not null defaultNow()`
- `lastUsedAt timestamp with time zone`
- `revokedAt timestamp with time zone`
- `createdAt timestamp with time zone not null defaultNow()`
- `updatedAt timestamp with time zone not null defaultNow()`

Add indexes:

- unique active connection per `identityId`
- `(identityId, status)`

Add `agent_google_calendar_action_audit`:

- `id uuid primary key defaultRandom()`
- `identityId text not null`
- `threadId text`
- `sourceMessageId text`
- `action text not null`
- `calendarId text`
- `eventId text`
- `status text enum ['succeeded', 'failed'] not null`
- `errorCode text`
- `createdAt timestamp with time zone not null defaultNow()`

Audit table should never store event descriptions, attendee lists, OAuth codes, access tokens, refresh tokens, or raw provider responses.

## Token Security

Use Node `crypto` AES-256-GCM for refresh token encryption.

Recommended key format:

- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` is a base64-encoded 32-byte key.
- Reject startup/use if key is absent or wrong length.

Store:

- ciphertext
- IV/nonce
- auth tag

Do not store access tokens unless there is a strong reason. Prefer deriving short-lived access tokens from the encrypted refresh token when needed, then discard them after the request.

Never log:

- authorization code
- OAuth state
- access token
- refresh token
- encrypted token material
- event descriptions
- attendee email lists unless the user explicitly asked to inspect attendees and the output is user-facing

## Tool Plan

### `manage-google-calendar-connection`

Actions:

- `status`
- `connect`
- `disconnect`

`connect`:

- Creates an OAuth state row.
- Returns a connection URL under `/links/google-calendar/connect/:requestId`.
- The assistant posts that link and says it expires soon.

`disconnect`:

- Revokes the refresh token with Google.
- Marks the connection revoked locally even if Google revocation returns "already invalid", but log the provider failure safely.

### `read-calendar`

Read-only actions:

- `list_calendars`
- `list_events`
- `get_event`
- `freebusy` if useful for scheduling decisions.

This tool should be enabled in chat mode and scheduled-task mode after a connection exists.

### `manage-calendar`

Mutation actions:

- `create_event`
- `update_event`
- `delete_event`

Fields to support in v1:

- calendar id or "primary"
- title
- start/end date-time with timezone
- all-day event date range
- description
- location
- attendees
- Google Meet creation
- recurrence only if the input can be represented safely; otherwise defer recurrence to a later slice
- sendUpdates: default should be `all` when attendees are present, otherwise omit or `none`

Important behavior:

- For "move/update/delete that event", the agent must first read/list events when the exact event id is not visible in context.
- For destructive or ambiguous deletion, ask for confirmation unless the event identity is unambiguous from the latest context.
- Return normalized event summaries, not raw Google resources.
- Log stable ids and status only.

Scheduled-task active tools:

- Allow `read-calendar`.
- Allow `manage-calendar` only for `create_event` initially.
- Do not allow scheduled tasks to update/delete calendar events without a later confirmation/reconciliation design.

## Prompt Updates

Update `AgentPromptService` routing guidance:

- Use `manage-google-calendar-connection` when the user asks to connect, disconnect, or check calendar connection status.
- Use `read-calendar` for calendar inspection, availability, event search, and free/busy checks.
- Use `manage-calendar` for explicit create/update/delete calendar-event requests.
- Do not claim calendar changes until the tool returns `ok=true`.
- Ask a brief clarification when title, date/time, timezone, calendar, or target event is ambiguous enough to create or mutate the wrong event.
- Use runtime timezone unless the user specifies a calendar/event timezone or durable knowledge clearly says otherwise.

## Google Meet Support

For Google Meet links, create events with conference data:

- Add `conferenceData.createRequest`.
- Set request parameter `conferenceDataVersion=1`.
- Generate a unique request id per event creation.

Do not reuse conference data across events.

## Attendees

Support attendee email addresses in v1.

Default behavior:

- If attendees are included, use `sendUpdates=all` unless the user asks not to email guests.
- If no attendees are included, avoid unnecessary notification parameters.
- Validate attendee emails before calling Google.
- Keep attendee lists out of logs.

## Calendar Selection

Use all writable calendars:

- Call CalendarList list.
- Filter calendars where access role can modify events, typically `writer` or `owner`.
- Prefer the user's explicitly named calendar when given.
- Prefer `primary` when no calendar is named.
- If multiple calendars match a natural name, ask a brief clarification.

Cache writable calendar metadata only if needed after the first implementation. Do not introduce cache tables until repeated API calls become a real issue.

## Error Handling

Add AppError codes:

- `GOOGLE_CALENDAR_CONNECTION_REQUIRED`
- `GOOGLE_CALENDAR_OAUTH_INVALID`
- `GOOGLE_CALENDAR_OAUTH_EXPIRED`
- `GOOGLE_CALENDAR_TOKEN_INVALID`
- `GOOGLE_CALENDAR_API_ERROR`
- `GOOGLE_CALENDAR_API_TIMEOUT`
- `GOOGLE_CALENDAR_EVENT_NOT_FOUND`
- `GOOGLE_CALENDAR_EVENT_AMBIGUOUS`
- `GOOGLE_CALENDAR_MUTATION_UNSAFE`

Expected user-safe failures:

- "Calendar is not connected yet. Use this link to connect it."
- "That connection link expired. Ask me to connect Calendar again."
- "I could not find that event. Give me the date or title and I will check again."
- "I found multiple matching events. Which one should I change?"
- "Google Calendar access expired or was revoked. Please reconnect Calendar."

## Testing Plan

Unit/integration-style tests around public module boundaries:

- Connection request creates a one-time state and returns a link.
- OAuth callback rejects missing/expired/consumed/mismatched state.
- OAuth callback exchanges code, verifies scopes, encrypts refresh token, stores active connection, and posts confirmation.
- Disconnect revokes token and marks connection revoked.
- Calendar list filters writable calendars.
- Event create maps domain input to Google event resource, including attendees and Meet request.
- Event update/delete require unambiguous event identity.
- Scheduled-task mode exposes read/create but not update/delete.
- Tools return safe `ok=false` messages without leaking provider details.

Mock:

- Google OAuth token endpoint/client
- Google Calendar API
- Telegram/Chat SDK posting
- DB services where testing app services

Do not add live Google integration tests unless explicitly requested.

## Implementation Sequence

1. Add DB schema/types/service for OAuth state, connection, and action audit.
2. Add token encryption service with tests.
3. Add Google OAuth service for auth URL, code exchange, token refresh, and revoke.
4. Add Google Calendar API client for calendar list and event CRUD.
5. Add `GoogleCalendarConnectionService`.
6. Add Hono link/callback router under `/links/google-calendar/*` and mount it from `src/index.ts`.
7. Add `manage-google-calendar-connection` tool.
8. Add `read-calendar` and `manage-calendar` tools.
9. Register tools in `agentTools` and `AgentService.#getActiveTools`.
10. Update prompt routing and tests.
11. Update env examples, README deployment docs, and `turbo.json` env list.
12. Run narrow checks:
    - `pnpm --filter @labjm/agent test -- google-calendar`
    - `pnpm --filter @labjm/agent typecheck`
    - `pnpm --filter @labjm/agent lint`

## Open Questions

- Should the callback success page include a deep link back to Telegram, or just say "Calendar connected, return to Telegram"?
- Should the agent store the connected Google account email via `openid email`, or avoid that extra scope and show only generic connection status?
- Should recurring calendar events be supported in the first mutation slice, or deferred until single-event CRUD is stable?
- Should update/delete require explicit confirmation even when the event id is visible from the immediately preceding tool result?

## Current Recommendation

Build v1 entirely inside `apps/agent` using `/links/google-calendar/*`.

Do not create `apps/links` yet. If link handling later needs analytics, reusable short links, branded non-agent URLs, or multiple integrations outside the agent, split it into a separate app then.

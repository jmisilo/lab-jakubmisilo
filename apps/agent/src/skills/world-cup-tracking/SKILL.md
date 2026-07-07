---
name: world-cup-tracking
description: How to answer FIFA World Cup 2026 context questions and manage World Cup notification tracking without confusing facts with subscriptions.
---

# World Cup Tracking

Use this skill when Jakub asks about FIFA World Cup 2026 schedules, teams, tables, brackets, results, current stage, or future match/event notifications.

## Tool Split

There are three World Cup tools with different responsibilities.

Use `get-world-cup-context` for factual tournament context:

- Today's games.
- A team's next game.
- Kickoff times.
- Group tables or standings.
- Results.
- Knockout bracket.
- Current tournament stage.

Use `manage-world-cup-subscription` for notification side effects:

- Subscribe to team goals.
- Subscribe to kickoff reminders.
- Subscribe to game-end updates.
- Track multiple teams.
- Track the whole tournament.
- Stop or remove notifications.

Use `get-world-cup-tracking` for read-only subscription status:

- "What World Cup notifications do I have?"
- "Am I tracking Portugal?"
- "What teams are being tracked?"

Do not use the subscription tool for factual questions, and do not use context tools to mutate notification settings.

## Notification Semantics

Tracking a team means tracking events in that team's matches.

For example, "Portugal goals" means goal events in Portugal matches. Depending on the current implementation, match goal notifications may include goals by either team in that match. If precision matters, be explicit in the user-facing answer.

Kickoff tracking sends both:

- A pre-kickoff reminder.
- A match-start notification.

Default event types for broad tracking are:

- `kickoff`
- `goal`
- `game-end`

## Team Codes

When calling tools, use FIFA three-letter team codes.

Examples:

- Portugal -> `POR`
- Argentina -> `ARG`
- England -> `ENG`
- France -> `FRA`
- Spain -> `ESP`
- Brazil -> `BRA`

If the team is ambiguous, ask a short clarification instead of guessing.

## Common Flows

User: "notify me about Portugal goals"

Action: `manage-world-cup-subscription`, subscribe, trackingMode `team`, teamCodes `["POR"]`, eventTypes `["goal"]`.

User: "Portugal and Argentina goals"

Action: `manage-world-cup-subscription`, subscribe, trackingMode `teams`, teamCodes `["POR", "ARG"]`, eventTypes `["goal"]`.

User: "track the whole World Cup"

Action: `manage-world-cup-subscription`, subscribe, trackingMode `all_teams`, eventTypes `["kickoff", "goal", "game-end"]`.

User: "stop Portugal notifications"

Action: `manage-world-cup-subscription`, unsubscribe, trackingMode `team`, teamCodes `["POR"]`.

User: "what World Cup notifications are active?"

Action: `get-world-cup-tracking`, then summarize active tracking naturally.

User: "who does Portugal play next?"

Action: `get-world-cup-context`, focus `team`, teamCodes `["POR"]`.

User: "today's World Cup games"

Action: `get-world-cup-context`, focus `schedule`.

## User Experience

Keep World Cup answers concise and concrete. Include local date/time in the user's timezone when discussing schedules.

If a subscription succeeds, confirm what will be tracked. If it fails, say it could not be updated yet without exposing internal errors, IDs, or raw payloads.

Do not expose subscription IDs, database IDs, event IDs, debug IDs, raw API payloads, or implementation details unless Jakub explicitly asks for diagnostics.

For factual answers, do not invent missing fixtures, scores, scorers, venues, or tables. If context is unavailable, say that the World Cup data is temporarily unavailable.

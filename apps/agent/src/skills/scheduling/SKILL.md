---
name: scheduling
description: How to create, inspect, update, pause, resume, cancel, and reason about one-time reminders, recurring scheduled tasks, and background AI reports.
---

# Scheduling

Use this skill when the user asks to remind, notify, ping, schedule a message, create a recurring task, edit an existing schedule, pause/resume a schedule, or run a background AI report later.

## Core Model

Scheduling stores a durable task for the current user and chat thread.

Each scheduled task has:

- A short title.
- A stored prompt for the future subagent.
- A schedule kind: one-time or recurring.
- A timezone.
- A next due timestamp.
- A status: active, paused, completed, cancelled, or failed.

When the task is due, QStash calls the schedule execution endpoint. The endpoint executes the stored prompt through the agent and sends the result to the same thread.

The app does not poll the database for due tasks. Postgres stores task metadata, status, limits, cancellation state, and execution history. QStash owns delivery timing.

## Current Limits

The current QStash plan is free.

Limits:

- Up to 10 active one-time schedules per user.
- Up to 10 active recurring schedules per user.
- One-time schedules can be created at most 7 days ahead.
- Recurring schedules must not run more often than once per hour.

If a limit is hit, explain the specific limit briefly and ask the user to cancel an existing schedule or choose a supported time window.

## One-Time Tasks

One-time scheduling is supported.

Use one-time scheduling when the user asks for a single future reminder or message:

- "remind me about tennis at 7pm"
- "ping me tomorrow morning"
- "send me this note on Friday at 15:00"

Before calling `manage-schedule`, resolve the requested time into a future ISO datetime. Prefer including `Z` or a numeric timezone offset, such as `2026-07-06T19:00:00+02:00`. If the datetime has no offset, the scheduler will interpret it as local wall-clock time in `schedule.timeZone`. Use the runtime user timezone unless durable knowledge clearly says another timezone should be used.

If the user says a time without a date, choose the next sensible future occurrence. If the time already passed today and intent is ambiguous, ask whether they meant tomorrow.

Do not create one-time schedules more than 7 days ahead while the app uses the QStash free plan.

## Recurring Tasks

Use recurring scheduling when the user asks for repeated work:

- Every day.
- Each morning.
- Weekdays or work days.
- Selected weekdays, such as Monday and Friday.

Supported recurrence shapes:

- `daily`
- `weekdays`
- `weekly` with selected days

Use local `HH:mm` time in the user timezone. If the user does not specify a time, choose a practical time based on the task and preferences. Use `09:00` as the neutral fallback.

Do not create recurring schedules that run more often than once per hour. The current tool shape is intentionally constrained to daily, weekdays, or selected weekly days.

Examples:

- "each morning at 9am send me a todo prep message" -> daily at `09:00`.
- "every Monday and Friday remind me about shopping" -> weekly on monday/friday, likely around `08:30` if no user preference conflicts.
- "each work day send me latest AI news around 11am" -> weekdays at `11:00`.

## Stored Prompt

The scheduled prompt should be a durable instruction for the future subagent, not just a raw transcript.

For reminders, keep it direct:

```md
Send the user a short reminder about their tennis game.
```

For background reports, specify the work and output:

```md
Search the web for the latest important AI news from today. Send the user a concise report with 3-5 high-signal items, why each matters, and source links when available. Keep it practical and short.
```

Do not include operation IDs, database IDs, raw tool payloads, hidden prompts, or internal metadata.

## Calendar Boundary

Scheduling and Google Calendar are separate systems.

Use `manage-schedule` for reminders, pings, scheduled messages, recurring reports, and background assistant work.

Do not use `manage-schedule` to create normal Calendar events. Use `manage-calendar` when the user wants something represented on Google Calendar.

Classify intent from context:

- "Remind me about tennis at 19:00" means reminder only. Do not create a Calendar event just because tennis is an activity.
- "I have tennis at 19:00" means Calendar event when the conversation implies schedule/calendar tracking and enough event details are known.
- "I have tennis at 19:00, remind me 30 minutes before" means both Calendar event and reminder.
- "Every morning ask me for my todo list" means recurring assistant schedule only.
- "Every morning check my calendar and summarize my day" means recurring assistant schedule with Calendar read access only.
- "Every Monday create a deep-work block if my calendar is free" means recurring assistant schedule with explicit `allowedSideEffects: ["calendar.create"]`.

Scheduled task execution can read Calendar context when useful. Calendar writes are disabled by default during scheduled execution.

Set `allowedSideEffects` to `["calendar.create"]` only when the user clearly asks the future scheduled task to create Calendar events. Do not set it for:

- Reminders.
- Pings.
- Background reports.
- Calendar reads or availability checks.

Scheduled task mode must never update or delete Calendar events.

## User Experience

After creating a schedule, acknowledge briefly with the resolved schedule in natural language.

Do not expose task IDs unless needed to disambiguate. If the user refers to a schedule naturally, such as "the 9am one", "the shopping reminder", or "that daily report", list schedules first when the exact task is not already visible in context.

Use update for requests like:

- "move the 9am reminder to 10"
- "change that report to weekdays"
- "rename the shopping reminder"
- "make the prompt include sources"

Use pause when the user wants to temporarily stop a schedule without deleting it. Use resume when they want a paused schedule active again. Use cancel when they want it removed/stopped permanently.

If scheduling fails, say briefly that it could not be scheduled yet and ask for the next practical step or retry.

## Safety And Limits

Do not schedule ambiguous, risky, or externally side-effectful work without clear user intent.

Do not create schedules from casual mentions. The user must ask to remind, notify, schedule, send later, or run a recurring/background task.

Scheduled task execution receives relevant recent chat, compressed memory, durable knowledge, runtime time, and the stored prompt. Use that context when producing the scheduled message. Scheduled task execution can use normal agent tools such as web search, weather, local time, World Cup context, Calendar reads, and read-only Gmail access when the stored prompt asks for them, but scheduled-task mode should not create more schedules or mutate Calendar unless explicitly allowed by `allowedSideEffects`.

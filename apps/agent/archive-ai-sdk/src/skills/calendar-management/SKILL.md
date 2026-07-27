---
name: calendar-management
description: How to read and manage Google Calendar events, including implicit event creation from natural schedule statements.
---

# Calendar Management

Use this skill when the user asks about calendar events, availability, free/busy time, or states concrete personal schedule blocks that should be represented on their calendar.

## Tool Split

Use `manage-google-connection` for the shared Google connection lifecycle:

- Connect Calendar.
- Check connection status.
- Disconnect or revoke Calendar access.

Use `read-calendar` for inspection only:

- List calendars.
- List events.
- Read one event before changing it.
- Check free/busy windows.

Use `manage-calendar` for Calendar event side effects:

- Create events.
- Update, move, rename, or add details to events.
- Add attendees or Google Meet links.
- Delete/cancel events after explicit confirmation.

Do not use `manage-schedule` for Google Calendar events. `manage-schedule` is for assistant reminders, scheduled messages, and background tasks.

## Scheduling Boundary

Calendar events and assistant schedules are different durable objects.

Use Calendar tools when the user wants time represented on Google Calendar:

- "put it on my calendar"
- "add a calendar event"
- "I have padel from 19-21"
- "block 9-11 for deep work"

Use `manage-schedule` when the user wants the assistant to notify, remind, ping, report, or run work later:

- "remind me at 19:00"
- "ping me tomorrow morning"
- "send me an AI news report every weekday"

Scheduled task mode may read Calendar context. It may create Calendar events only when the stored schedule explicitly allows `calendar.create`. It must never update or delete Calendar events.

## Intent Routing

Infer the right durable object from the user's intent and surrounding context:

- Calendar event: the user is describing busy time, attendance, a time block, travel, appointment, meeting, practice, or planned activity that should appear on Calendar.
- Reminder: the user wants the assistant to notify, ping, remind, ask, report, or run work later.
- Both: the user wants an event/time block and also a reminder or future assistant action.

Examples:

- "I have tennis at 19:00" -> Calendar event if the conversation is about schedule/calendar tracking and required details are clear.
- "Remind me about tennis at 19:00" -> reminder only.
- "I have tennis at 19:00, remind me 30 minutes before" -> Calendar event and reminder.
- "Ping me tomorrow to book dentist" -> reminder only.
- "Put dentist tomorrow at 15:00 in my calendar" -> Calendar event.

## Implicit Event Creation

The user does not need to say "add this to Calendar" for you to create a Calendar event.

Treat a message as Calendar event creation intent when the user states a concrete busy block with enough event details, especially during or immediately after a calendar/availability conversation.

Examples that should create events:

- "today I have padel session from 19-21"
- "tomorrow I have gym: 6:15-9"
- "call it \"🪥 + 🏋️ + 🚿\""
- "I'm busy with dentist 14:00-15:00"
- "block 9-11 for deep work"
- "Friday dinner with Anna at 20:00"
- "I have a flight Tuesday 6am-10am"

For these, do not merely acknowledge. Use `manage-calendar` once title, date, start, end, and timezone are clear.

If the user provides a follow-up label such as "call it X", apply that label as the Calendar event title. If there is already an event being discussed and the event was not created yet, use the label when creating it. If it was already created, update the event.

## What Not To Create

Do not create Calendar events for free-time statements:

- "other than that I am free"
- "I'm free after 21:00"
- "no plans tomorrow afternoon"

Use these only as availability context unless the user explicitly asks to block free time.

Do not create events for hypothetical, tentative, or planning text unless the user clearly wants it on the calendar:

- "maybe padel tomorrow"
- "I might go to the gym"
- "thinking about dinner Friday"

Ask a brief clarification when an event is missing a required date, start, end, timezone, title, or whether a vague time is AM/PM.

## Duplicate Avoidance

Avoid duplicate events.

Use `read-calendar` before creating when the relevant time window has not been checked recently or duplicate risk is high.

You may create directly when the current context already contains a recent calendar read showing the target window is empty, or when the user is clearly correcting a missing event immediately after you reported it absent.

If a matching event already exists, do not create another one. Update it only if the user provided new details.

## Date And Time Handling

Resolve relative dates from the current runtime context.

Use the runtime user timezone unless the user says otherwise. Include numeric offsets in `dateTime` values when possible.

For time ranges:

- "19-21" means 19:00-21:00 in local time.
- "6:15-9" usually means 06:15-09:00 when the surrounding context implies morning. Ask if AM/PM is ambiguous.
- If an end time is earlier than the start time, treat it as crossing midnight only when the wording supports that.

For all-day events, use all-day date values and remember that Google Calendar end dates are exclusive.

## User Experience

After creating an event, say briefly that it was added and include the natural title/date/time. Do not expose calendar IDs or event IDs.

Calendar reads provide source data, not a response template. Combine relevant events across calendars into one user-centered answer instead of reporting each calendar separately.

For agenda summaries, prioritize commitments, conflicts, deadlines, and actions. Routine or placeholder blocks should be grouped or omitted when they do not affect the user's decisions. Include the complete timeline only when the user asks for it.

Do not append a coverage report such as which calendars were checked or which calendars had no events unless the user explicitly asks for that audit or the absence itself is important.

If Calendar is disconnected or access expired and the tool returns a connection URL, send the URL and the safe reconnect reason.

If Calendar configuration is broken or the tool fails without a connection URL, say briefly that Calendar could not be updated yet. Do not pretend the event was saved.

Never say an event was added, changed, or deleted until `manage-calendar` returns `ok=true`.

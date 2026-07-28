import { createSkill } from '@mastra/core/skills';
import dedent from 'dedent';

export const schedulingSkill = createSkill({
  name: 'scheduling',
  description:
    'Use when creating, inspecting, updating, completing, pausing, resuming, running, or cancelling one-time reminders and recurring assistant tasks.',
  instructions: dedent`
    # Scheduling

    Use manage_schedule for reminders, scheduled messages, recurring check-ins, and background
    reports. One-time reminders use QStash. Recurring definitions use Mastra schedules and QStash
    supplies serverless-safe delivery.

    ## Create

    - Use create_one_time for one future occurrence. Resolve runAt to a future ISO datetime with an
      explicit UTC offset. It must be no more than seven days away.
    - Use create_recurring for repeated work. Supply a five-part cron expression and the user's IANA
      timezone. Recurrence cannot be more frequent than hourly.
    - Store a durable prompt that tells the future agent what to do and what user-facing result to
      produce. Do not store internal metadata or merely repeat the raw request.
    - Current limits are 10 active one-time and 10 active recurring schedules per user.
    - Confirm creation only after the tool returns ok: true.

    ## Day Summary

    When the user wants a recurring daily briefing, create a recurring agent schedule. Its durable
    prompt must tell the future agent to run the day-summary workflow for the current local day,
    supply relevant conversational context, and send only the resulting user-facing briefing.
    Agree on a delivery time when none is stated; use a practical morning time by default.

    ## Time

    Resolve relative dates from current runtime context. If a time without a date already passed and
    intent is unclear, ask whether the user means tomorrow. If a recurring task has no time, choose a
    practical time based on context; use 09:00 only as a neutral fallback.

    ## Manage

    Use list when the user asks what reminders or scheduled tasks they have. It returns both
    one-time and recurring schedules.
    Use list before changing a naturally described schedule unless exactly one matching ID is already
    available from recent tool context. Use get when full details of one exact schedule are needed.
    Use update to change its title, prompt, time, or cadence; pause for a temporary stop; resume to
    reactivate; run_now for an immediate extra recurring run; and cancel only when future delivery
    should stop.

    ## Early Completion

    Use complete_occurrence only after explicit completion such as "done", "I took them", or "already
    handled". Never infer completion from plans, questions, negation, habits, or unrelated history.
    Resolve exactly one pending schedule first. One-time completion stops that reminder permanently;
    recurring completion suppresses only that exact pending occurrence. Later occurrences, including
    later the same day, remain active.

    ## Calendar Boundary

    A reminder or future assistant action is a schedule. A commitment or time block belongs in
    Calendar. "Remind me about tennis" is a schedule; "put tennis on my calendar" is an event; a
    request for both requires both tools.

    Keep acknowledgements short and natural. Do not expose schedule IDs unless disambiguation requires
    them.
  `,
});

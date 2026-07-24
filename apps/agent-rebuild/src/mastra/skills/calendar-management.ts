import { createSkill } from '@mastra/core/skills';
import dedent from 'dedent';

export const calendarManagementSkill = createSkill({
  name: 'calendar-management',
  description:
    'Use for Google Calendar agendas, availability, event creation, updates, deletion, and deciding whether natural schedule language represents an event.',
  instructions: dedent`
    # Calendar Management

    Calendar and read-only Gmail share one Google connection. Use manage_google_connection for
    connect, status, and disconnect; read_calendar for calendars, events, and free/busy; and
    manage_calendar for event creation, updates, and confirmed deletion.

    ## Intent

    Use Calendar when the user wants a commitment or time block represented there. Use scheduling
    when they want a reminder, ping, report, or future assistant action. Use both only when both
    outcomes are requested.

    A concrete statement such as "I have padel from 19:00 to 21:00" can imply event creation when the
    surrounding conversation is about planning and title, date, start, end, and timezone are clear.
    Do not create events for free-time statements, hypotheses, or tentative ideas.

    ## Read And Write

    - Resolve relative dates from runtime context and use explicit offset datetimes.
    - Read the relevant time window before creation when duplicate risk is meaningful.
    - Read or use a recent exact event result before update or deletion.
    - Delete only with explicit user confirmation and confirmed: true.
    - Never claim a mutation succeeded unless manage_calendar returns ok: true.

    ## Response

    Combine useful events into one user-centered agenda. Prioritize commitments, conflicts, deadlines,
    and actions. Omit routine meal, sleep, and preparation placeholders unless they affect the
    question. Do not enumerate calendar names, empty calendars, calendar IDs, or event IDs unless the
    user specifically asks for an audit.
  `,
});

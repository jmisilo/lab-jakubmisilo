import type { Mastra } from '@mastra/core/mastra';

import { MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { createStep, createWorkflow } from '@mastra/core/workflows';

import { logger } from '../../../infrastructure/logger';
import { GoogleService } from '../../modules/google';
import { SchedulingService } from '../../modules/scheduling';
import { resolveIdentityId, resolveTimeZone } from '../../runtime-context';
import {
  DaySummaryContextSchema,
  DaySummaryDayWindowSchema,
  DaySummaryInputSchema,
  DaySummaryModelOutputSchema,
  DaySummaryOutputSchema,
} from './schemas';
import { daySummaryAgent } from './summary-agent';

const MAX_CALENDARS = 20;
const MAX_EVENTS_PER_CALENDAR = 25;
const MAX_AGENDA_EVENTS = 50;

const resolveDayStep = createStep({
  id: 'resolve-day',
  description: 'Resolve the requested day, defaulting to today in the user timezone.',
  inputSchema: DaySummaryInputSchema,
  outputSchema: DaySummaryDayWindowSchema,
  execute: async ({ inputData, requestContext }) => {
    const timeZone = resolveTimeZone(requestContext);
    const date = inputData.date ?? formatLocalDate(new Date(), timeZone);

    return {
      date,
      timeZone,
      timeMin: localMidnightToUtc(date, timeZone).toISOString(),
      timeMax: localMidnightToUtc(nextDate(date), timeZone).toISOString(),
      ...(inputData.relevantContext ? { relevantContext: inputData.relevantContext } : {}),
    };
  },
});

const gatherDayContextStep = createStep({
  id: 'gather-day-context',
  description: 'Read calendar events and scheduled tasks relevant to the requested day.',
  inputSchema: DaySummaryDayWindowSchema,
  outputSchema: DaySummaryContextSchema,
  execute: async ({ inputData, requestContext, mastra }) => {
    const resourceId = resolveIdentityId(requestContext);

    if (!resourceId) {
      throw new Error('Day summary requires a user identity.');
    }

    const [calendar, schedules] = await Promise.all([
      readCalendarContext({
        resourceId,
        timeMin: inputData.timeMin,
        timeMax: inputData.timeMax,
      }),
      readScheduleContext({
        mastra,
        resourceId,
        timeMin: inputData.timeMin,
        timeMax: inputData.timeMax,
      }),
    ]);

    logger.info('Day summary context gathered', {
      date: inputData.date,
      timeZone: inputData.timeZone,
      calendarAvailable: calendar.available,
      calendarEventCount: calendar.events.length,
      schedulesAvailable: schedules.available,
      scheduledTaskCount: schedules.tasks.length,
    });

    return {
      ...inputData,
      calendar,
      schedules,
    };
  },
});

const summarizeDayStep = createStep({
  id: 'summarize-day',
  description: 'Create the final user-facing day briefing.',
  inputSchema: DaySummaryContextSchema,
  outputSchema: DaySummaryOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const resourceId = resolveIdentityId(requestContext);

    if (!resourceId) {
      throw new Error('Day summary requires a user identity.');
    }

    const requestThreadId = requestContext?.get(MASTRA_THREAD_ID_KEY);
    const threadId =
      typeof requestThreadId === 'string' && requestThreadId.trim()
        ? requestThreadId
        : `day-summary:${resourceId}:${inputData.date}`;
    const result = await daySummaryAgent.generate(
      [
        {
          role: 'user',
          content: [
            `Target date: ${inputData.date}`,
            `Timezone: ${inputData.timeZone}`,
            '',
            'Relevant context:',
            inputData.relevantContext ?? 'No additional context was supplied.',
            '',
            'Calendar:',
            JSON.stringify(inputData.calendar),
            '',
            'Scheduled tasks:',
            JSON.stringify(inputData.schedules),
          ].join('\n'),
        },
      ],
      {
        memory: {
          resource: resourceId,
          thread: threadId,
        },
        requestContext,
        structuredOutput: {
          schema: DaySummaryModelOutputSchema,
        },
      },
    );

    return {
      date: inputData.date,
      timeZone: inputData.timeZone,
      summary: result.object.summary,
      calendarAvailable: inputData.calendar.available,
      schedulesAvailable: inputData.schedules.available,
      eventCount: inputData.calendar.events.length,
      scheduledTaskCount: inputData.schedules.tasks.length,
    };
  },
});

export const daySummaryWorkflow = createWorkflow({
  id: 'day-summary',
  description:
    'Prepare a concise briefing for a day from Calendar, Gmail when useful, reminders, and relevant conversational context. Use on demand or from a scheduled agent run. Omit date to summarize today; provide an explicit date when the user names another day. Pass only relevant priorities, unfinished tasks, completions, commitments, and preferences as relevantContext. Return the summary naturally without exposing workflow metadata.',
  inputSchema: DaySummaryInputSchema,
  outputSchema: DaySummaryOutputSchema,
})
  .then(resolveDayStep)
  .then(gatherDayContextStep)
  .then(summarizeDayStep)
  .commit();

async function readCalendarContext({ resourceId, timeMin, timeMax }: ReadContextInput) {
  try {
    const calendars = (await GoogleService.listCalendars(resourceId)).slice(0, MAX_CALENDARS);
    const results = await Promise.allSettled(
      calendars.map((calendar) =>
        GoogleService.listCalendarEvents({
          resourceId,
          calendarId: calendar.id,
          timeMin,
          timeMax,
          maxResults: MAX_EVENTS_PER_CALENDAR,
        }),
      ),
    );
    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof GoogleService.listCalendarEvents>>
      > => result.status === 'fulfilled',
    );

    if (calendars.length > 0 && fulfilled.length === 0) {
      throw new Error('No connected calendar could be read.');
    }

    return {
      available: true,
      events: fulfilled
        .flatMap((result) => result.value)
        .filter((event) => event.status !== 'cancelled' && event.start && event.end)
        .map((event) => ({
          title: event.summary?.trim() || 'Untitled event',
          start: event.start?.dateTime ?? event.start?.date ?? '',
          end: event.end?.dateTime ?? event.end?.date ?? '',
          allDay: Boolean(event.start?.date && !event.start.dateTime),
          ...(event.location ? { location: event.location } : {}),
        }))
        .filter((event) => event.start && event.end)
        .sort((left, right) => left.start.localeCompare(right.start))
        .slice(0, MAX_AGENDA_EVENTS),
    };
  } catch (error) {
    logger.warn('Day summary calendar context unavailable', {
      error: safeError(error),
    });

    return {
      available: false,
      events: [],
    };
  }
}

async function readScheduleContext({
  mastra,
  resourceId,
  timeMin,
  timeMax,
}: ReadScheduleContextInput) {
  try {
    const schedules = await SchedulingService.list({
      schedules: mastra.schedules,
      resourceId,
      includeInactive: false,
    });
    const startsAt = new Date(timeMin).getTime();
    const endsAt = new Date(timeMax).getTime();
    const recurring = schedules.recurring.flatMap((schedule) => {
      if (typeof schedule.agentId !== 'string' || schedule.status !== 'active') {
        return [];
      }

      const nextRunAt =
        'nextRunAt' in schedule.trigger && typeof schedule.trigger.nextRunAt === 'number'
          ? schedule.trigger.nextRunAt
          : schedule.nextFireAt;

      if (nextRunAt < startsAt || nextRunAt >= endsAt) {
        return [];
      }

      return [
        {
          title: schedule.name?.trim() || 'Scheduled task',
          scheduledFor: new Date(nextRunAt).toISOString(),
          recurring: true,
        },
      ];
    });
    const oneTime = schedules.oneTime
      .filter((schedule) => {
        const runAt = schedule.runAt.getTime();

        return runAt >= startsAt && runAt < endsAt;
      })
      .map((schedule) => ({
        title: schedule.title,
        scheduledFor: schedule.runAt.toISOString(),
        recurring: false,
      }));

    return {
      available: true,
      tasks: [...recurring, ...oneTime].sort((left, right) =>
        left.scheduledFor.localeCompare(right.scheduledFor),
      ),
    };
  } catch (error) {
    logger.warn('Day summary schedule context unavailable', {
      error: safeError(error),
    });

    return {
      available: false,
      tasks: [],
    };
  }
}

function formatLocalDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
}

function nextDate(date: string) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);

  return next.toISOString().slice(0, 10);
}

function localMidnightToUtc(date: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const targetTimestamp = Date.UTC(year!, month! - 1, day!);
  let timestamp = targetTimestamp;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone,
    })
      .formatToParts(new Date(timestamp))
      .reduce<Record<string, number>>((result, part) => {
        if (part.type !== 'literal') {
          result[part.type] = Number(part.value);
        }

        return result;
      }, {});
    const representedTimestamp = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
      parts.second!,
    );

    timestamp += targetTimestamp - representedTimestamp;
  }

  return new Date(timestamp);
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : String(error);
}

type ReadContextInput = {
  resourceId: string;
  timeMin: string;
  timeMax: string;
};

type ReadScheduleContextInput = ReadContextInput & {
  mastra: Mastra;
};

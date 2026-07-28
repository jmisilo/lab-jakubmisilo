import { z } from 'zod';

export const DaySummaryInputSchema = z.object({
  date: z.iso
    .date()
    .optional()
    .describe('Local date to summarize, formatted YYYY-MM-DD. Omit to summarize today.'),
  relevantContext: z
    .string()
    .max(6_000)
    .optional()
    .describe(
      'Concise context about relevant priorities, unfinished tasks, explicit completions, commitments, or preferences from the current conversation and memory.',
    ),
});

export const DaySummaryDayWindowSchema = z.object({
  date: z.iso.date(),
  timeZone: z.string().min(1),
  timeMin: z.iso.datetime({ offset: true }),
  timeMax: z.iso.datetime({ offset: true }),
  relevantContext: z.string().max(6_000).optional(),
});

const DaySummaryCalendarEventSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().optional(),
});

const DaySummaryScheduledTaskSchema = z.object({
  title: z.string(),
  scheduledFor: z.iso.datetime({ offset: true }),
  recurring: z.boolean(),
});

export const DaySummaryContextSchema = DaySummaryDayWindowSchema.extend({
  calendar: z.object({
    available: z.boolean(),
    events: z.array(DaySummaryCalendarEventSchema),
  }),
  schedules: z.object({
    available: z.boolean(),
    tasks: z.array(DaySummaryScheduledTaskSchema),
  }),
});

export const DaySummaryModelOutputSchema = z.object({
  summary: z.string().min(1).max(6_000),
});

export const DaySummaryOutputSchema = z.object({
  date: z.iso.date(),
  timeZone: z.string().min(1),
  summary: z.string().min(1).max(6_000),
  calendarAvailable: z.boolean(),
  schedulesAvailable: z.boolean(),
  eventCount: z.number().int().nonnegative(),
  scheduledTaskCount: z.number().int().nonnegative(),
});

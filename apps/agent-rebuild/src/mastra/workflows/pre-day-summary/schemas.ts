import { z } from 'zod';

export const PreDaySummaryInputSchema = z.object({
  date: z.iso
    .date()
    .optional()
    .describe(
      'Local date to summarize, formatted YYYY-MM-DD. Omit only when the upcoming day means tomorrow.',
    ),
  relevantContext: z
    .string()
    .max(6_000)
    .optional()
    .describe(
      'Concise context about relevant priorities, unfinished tasks, explicit completions, commitments, or preferences from the current conversation and memory.',
    ),
});

export const PreDaySummaryDayWindowSchema = z.object({
  date: z.iso.date(),
  timeZone: z.string().min(1),
  timeMin: z.iso.datetime({ offset: true }),
  timeMax: z.iso.datetime({ offset: true }),
  relevantContext: z.string().max(6_000).optional(),
});

const PreDaySummaryCalendarEventSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  location: z.string().optional(),
});

const PreDaySummaryScheduledTaskSchema = z.object({
  title: z.string(),
  scheduledFor: z.iso.datetime({ offset: true }),
  recurring: z.boolean(),
});

export const PreDaySummaryContextSchema = PreDaySummaryDayWindowSchema.extend({
  calendar: z.object({
    available: z.boolean(),
    events: z.array(PreDaySummaryCalendarEventSchema),
  }),
  schedules: z.object({
    available: z.boolean(),
    tasks: z.array(PreDaySummaryScheduledTaskSchema),
  }),
});

export const PreDaySummaryModelOutputSchema = z.object({
  summary: z.string().min(1).max(6_000),
});

export const PreDaySummaryOutputSchema = z.object({
  date: z.iso.date(),
  timeZone: z.string().min(1),
  summary: z.string().min(1).max(6_000),
  calendarAvailable: z.boolean(),
  schedulesAvailable: z.boolean(),
  eventCount: z.number().int().nonnegative(),
  scheduledTaskCount: z.number().int().nonnegative(),
});

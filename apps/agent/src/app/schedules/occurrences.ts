import { Cron } from 'croner';

const EARLY_DELIVERY_TOLERANCE_MS = 60_000;

type RecurringOccurrenceInput = {
  cron: string;
  timeZone: string;
};

export function nextPendingRecurringOccurrence({
  cron,
  timeZone,
  now,
}: RecurringOccurrenceInput & { now: Date }) {
  return new Cron(cron, {
    timezone: timeZone,
    paused: true,
  }).nextRun(new Date(now.getTime() - EARLY_DELIVERY_TOLERANCE_MS - 1));
}

/**
 * Resolves the occurrence a user means when they mark a recurring task done.
 * Before today's first run this is the next run; after a run it is the most
 * recent run today. This matters for hourly schedules, where always choosing
 * the next run would incorrectly complete 11:00 when the user responds to the
 * 10:00 occurrence at 10:30.
 */
export function recurringOccurrenceForCompletion({
  cron,
  timeZone,
  now,
}: RecurringOccurrenceInput & { now: Date }) {
  const schedule = new Cron(cron, {
    timezone: timeZone,
    paused: true,
  });
  const next = schedule.nextRun(new Date(now.getTime() - 1));

  if (
    next &&
    next.getTime() >= now.getTime() &&
    next.getTime() - now.getTime() <= EARLY_DELIVERY_TOLERANCE_MS
  ) {
    return next;
  }

  const previous = schedule.previousRuns(1, new Date(now.getTime() + 1))[0] ?? null;

  if (previous && localDate(previous, timeZone) === localDate(now, timeZone)) {
    return previous;
  }

  return next && localDate(next, timeZone) === localDate(now, timeZone) ? next : null;
}

export function recurringOccurrenceForTrigger({
  cron,
  timeZone,
  firedAt,
}: RecurringOccurrenceInput & { firedAt: Date }) {
  const schedule = new Cron(cron, {
    timezone: timeZone,
    paused: true,
  });
  const previous = schedule.previousRuns(1, new Date(firedAt.getTime() + 1))[0] ?? null;
  const next = schedule.nextRun(new Date(firedAt.getTime() - 1));

  if (
    next &&
    next.getTime() >= firedAt.getTime() &&
    next.getTime() - firedAt.getTime() <= EARLY_DELIVERY_TOLERANCE_MS
  ) {
    return next;
  }

  return previous;
}

function localDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

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

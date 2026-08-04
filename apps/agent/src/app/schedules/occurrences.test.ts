import { describe, expect, it } from 'vitest';

import {
  nextPendingRecurringOccurrence,
  recurringOccurrenceForCompletion,
  recurringOccurrenceForTrigger,
} from './occurrences';

describe('recurring schedule occurrences', () => {
  it('gives each hourly occurrence a distinct scheduled timestamp', () => {
    const completion = nextPendingRecurringOccurrence({
      cron: '0 * * * *',
      timeZone: 'Europe/Warsaw',
      now: new Date('2026-07-28T06:59:30.000Z'),
    });
    const firstDelivery = recurringOccurrenceForTrigger({
      cron: '0 * * * *',
      timeZone: 'Europe/Warsaw',
      firedAt: new Date('2026-07-28T07:00:15.000Z'),
    });
    const secondDelivery = recurringOccurrenceForTrigger({
      cron: '0 * * * *',
      timeZone: 'Europe/Warsaw',
      firedAt: new Date('2026-07-28T08:00:15.000Z'),
    });

    expect(completion?.toISOString()).toBe('2026-07-28T07:00:00.000Z');
    expect(firstDelivery).toEqual(completion);
    expect(secondDelivery?.toISOString()).toBe('2026-07-28T08:00:00.000Z');
    expect(secondDelivery).not.toEqual(completion);
  });

  it('maps a slightly early delivery to the imminent occurrence', () => {
    expect(
      recurringOccurrenceForTrigger({
        cron: '0 * * * *',
        timeZone: 'UTC',
        firedAt: new Date('2026-07-28T08:59:30.000Z'),
      })?.toISOString(),
    ).toBe('2026-07-28T09:00:00.000Z');
  });

  it('includes the exact early-delivery tolerance boundary', () => {
    expect(
      recurringOccurrenceForTrigger({
        cron: '0 * * * *',
        timeZone: 'UTC',
        firedAt: new Date('2026-07-28T08:59:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-07-28T09:00:00.000Z');
    expect(
      nextPendingRecurringOccurrence({
        cron: '0 * * * *',
        timeZone: 'UTC',
        now: new Date('2026-07-28T09:01:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-07-28T09:00:00.000Z');
  });

  it('maps a delayed delivery to its most recent scheduled occurrence', () => {
    expect(
      recurringOccurrenceForTrigger({
        cron: '0 * * * *',
        timeZone: 'UTC',
        firedAt: new Date('2026-07-28T09:12:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-07-28T09:00:00.000Z');
  });

  it('completes the most recent hourly occurrence instead of the next one', () => {
    expect(
      recurringOccurrenceForCompletion({
        cron: '0 * * * *',
        timeZone: 'UTC',
        now: new Date('2026-07-28T09:30:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-07-28T09:00:00.000Z');
  });

  it('completes the next occurrence before the first run of the local day', () => {
    expect(
      recurringOccurrenceForCompletion({
        cron: '45 8 * * *',
        timeZone: 'Europe/Warsaw',
        now: new Date('2026-07-28T05:00:00.000Z'),
      })?.toISOString(),
    ).toBe('2026-07-28T06:45:00.000Z');
  });

  it('returns no completion target when the schedule has no occurrence today', () => {
    expect(
      recurringOccurrenceForCompletion({
        cron: '0 9 * * 1',
        timeZone: 'UTC',
        now: new Date('2026-07-28T12:00:00.000Z'),
      }),
    ).toBeNull();
  });
});

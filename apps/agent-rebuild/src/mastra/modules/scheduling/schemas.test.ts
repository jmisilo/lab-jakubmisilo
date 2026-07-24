import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ManageScheduleInputSchema, ManageScheduleRequestSchema } from './schemas';

describe('scheduling schemas', () => {
  it('exposes an object-shaped schema to the model provider', () => {
    expect(z.toJSONSchema(ManageScheduleInputSchema)).toMatchObject({
      type: 'object',
    });
  });

  it('requires action-specific fields before execution', () => {
    expect(() =>
      ManageScheduleRequestSchema.parse({
        action: 'create_one_time',
        title: 'Call mum',
      }),
    ).toThrow();
  });

  it('accepts one-time schedules only with an explicit offset', () => {
    expect(() =>
      ManageScheduleRequestSchema.parse({
        action: 'create_one_time',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: '2026-07-24T19:00:00',
      }),
    ).toThrow();

    expect(
      ManageScheduleRequestSchema.parse({
        action: 'create_one_time',
        title: 'Call mum',
        prompt: 'Remind the user to call mum.',
        runAt: '2026-07-24T19:00:00+02:00',
      }),
    ).toMatchObject({ action: 'create_one_time' });
  });

  it('requires an exact schedule id for occurrence completion', () => {
    expect(
      ManageScheduleRequestSchema.safeParse({
        action: 'complete_occurrence',
      }).success,
    ).toBe(false);
    expect(
      ManageScheduleRequestSchema.parse({
        action: 'complete_occurrence',
        scheduleId: 'agent_supplements',
      }),
    ).toEqual({
      action: 'complete_occurrence',
      scheduleId: 'agent_supplements',
    });
  });
});

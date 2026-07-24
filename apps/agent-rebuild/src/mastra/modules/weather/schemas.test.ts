import { describe, expect, it } from 'vitest';

import { ReadLocalTimeInputSchema, ReadWeatherInputSchema } from './schemas';

describe('weather tool schemas', () => {
  it('exposes object-shaped provider schemas', () => {
    expect(ReadWeatherInputSchema.toJSONSchema().type).toBe('object');
    expect(ReadLocalTimeInputSchema.toJSONSchema().type).toBe('object');
  });

  it('rejects forecast dates beyond the supported relative range', () => {
    expect(
      ReadWeatherInputSchema.safeParse({
        location: 'Warsaw',
        mode: 'forecast',
        daysFromNow: 6,
      }).success,
    ).toBe(false);
  });
});

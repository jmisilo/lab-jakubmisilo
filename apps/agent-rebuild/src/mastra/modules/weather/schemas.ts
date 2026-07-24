import { z } from 'zod';

export const WeatherUnitsSchema = z.enum(['metric', 'imperial']);

export const ReadWeatherInputSchema = z.object({
  location: z
    .string()
    .min(1)
    .max(160)
    .describe('Explicit city/place, or a stable default location visible in user context.'),
  mode: z
    .enum(['current', 'forecast'])
    .describe('Use forecast for future weather, including later today.'),
  units: WeatherUnitsSchema.default('metric'),
  daysFromNow: z.number().int().min(0).max(5).optional(),
  targetLocalDate: z.iso.date().optional(),
  targetHour: z.number().int().min(0).max(23).optional(),
});

export const ReadLocalTimeInputSchema = z.object({
  location: z.string().min(1).max(160),
});

export const OpenWeatherGeocodingResponseSchema = z.array(
  z.object({
    name: z.string(),
    local_names: z.record(z.string(), z.string()).optional(),
    lat: z.number(),
    lon: z.number(),
    country: z.string(),
    state: z.string().optional(),
  }),
);

const OpenWeatherConditionSchema = z.object({
  description: z.string(),
});

export const OpenWeatherCurrentResponseSchema = z.object({
  dt: z.number(),
  timezone: z.number(),
  main: z.object({
    temp: z.number(),
    feels_like: z.number(),
    humidity: z.number(),
  }),
  weather: z.array(OpenWeatherConditionSchema).min(1),
  wind: z.object({
    speed: z.number(),
  }),
  rain: z
    .object({
      '1h': z.number().optional(),
    })
    .optional(),
  snow: z
    .object({
      '1h': z.number().optional(),
    })
    .optional(),
});

export const OpenWeatherForecastResponseSchema = z.object({
  city: z.object({
    timezone: z.number(),
  }),
  list: z
    .array(
      z.object({
        dt: z.number(),
        main: z.object({
          temp: z.number(),
          feels_like: z.number(),
          humidity: z.number(),
        }),
        weather: z.array(OpenWeatherConditionSchema).min(1),
        wind: z.object({
          speed: z.number(),
        }),
        pop: z.number().min(0).max(1),
        rain: z
          .object({
            '3h': z.number().optional(),
          })
          .optional(),
        snow: z
          .object({
            '3h': z.number().optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

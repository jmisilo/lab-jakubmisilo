import { z } from 'zod';

export const OpenWeatherGeocodingResponseSchema = z.array(
  z.object({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    country: z.string(),
    state: z.string().optional(),
  }),
);

export const OpenWeatherCurrentResponseSchema = z.object({
  weather: z
    .array(
      z.object({
        id: z.number(),
        main: z.string(),
        description: z.string(),
        icon: z.string(),
      }),
    )
    .min(1),
  main: z.object({
    temp: z.number(),
    feels_like: z.number(),
    pressure: z.number(),
    humidity: z.number(),
  }),
  visibility: z.number().optional(),
  wind: z.object({
    speed: z.number(),
    deg: z.number().optional(),
    gust: z.number().optional(),
  }),
  rain: z.object({ '1h': z.number().optional() }).optional(),
  snow: z.object({ '1h': z.number().optional() }).optional(),
  clouds: z.object({
    all: z.number(),
  }),
  dt: z.number(),
  timezone: z.number(),
});

export const OpenWeatherForecastPointSchema = z.object({
  dt: z.number(),
  main: z.object({
    temp: z.number(),
    feels_like: z.number(),
    pressure: z.number(),
    humidity: z.number(),
  }),
  weather: z
    .array(
      z.object({
        id: z.number(),
        main: z.string(),
        description: z.string(),
        icon: z.string(),
      }),
    )
    .min(1),
  clouds: z.object({
    all: z.number(),
  }),
  wind: z.object({
    speed: z.number(),
    deg: z.number().optional(),
    gust: z.number().optional(),
  }),
  visibility: z.number().optional(),
  pop: z.number().optional(),
  rain: z.object({ '3h': z.number().optional() }).optional(),
  snow: z.object({ '3h': z.number().optional() }).optional(),
  dt_txt: z.string().optional(),
});

export const OpenWeatherForecastResponseSchema = z.object({
  cnt: z.number(),
  list: z.array(OpenWeatherForecastPointSchema).min(1),
  city: z.object({
    name: z.string(),
    country: z.string(),
    timezone: z.number(),
  }),
});

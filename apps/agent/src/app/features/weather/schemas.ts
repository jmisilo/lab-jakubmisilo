import { z } from 'zod';

export const WeatherUnitsSchema = z.enum(['metric', 'imperial']);
export const WeatherForecastTimeOfDaySchema = z.enum(['morning', 'afternoon', 'evening', 'night']);

export const OpenWeatherGeocodingResultSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  country: z.string(),
  state: z.string().optional(),
});

export const OpenWeatherGeocodingResponseSchema = z.array(OpenWeatherGeocodingResultSchema);

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

const CoordinatesSchema = z.object({
  lat: z.number(),
  lon: z.number(),
});

export const CurrentWeatherSchema = z.object({
  requestedLocation: z.string(),
  resolvedLocation: z.string(),
  country: z.string().optional(),
  coordinates: CoordinatesSchema,
  units: WeatherUnitsSchema,
  temperature: z.number(),
  feelsLike: z.number(),
  humidity: z.number(),
  pressure: z.number(),
  description: z.string(),
  windSpeed: z.number(),
  windDirection: z.number().optional(),
  cloudiness: z.number(),
  visibility: z.number().optional(),
  rainLastHour: z.number().optional(),
  snowLastHour: z.number().optional(),
  observedAt: z.string(),
});

export const WeatherForecastPointSchema = z.object({
  forecastedAt: z.string(),
  forecastedAtLocal: z.string(),
  localDate: z.string(),
  localHour: z.number(),
  temperature: z.number(),
  feelsLike: z.number(),
  humidity: z.number(),
  pressure: z.number(),
  description: z.string(),
  windSpeed: z.number(),
  windDirection: z.number().optional(),
  cloudiness: z.number(),
  visibility: z.number().optional(),
  precipitationProbability: z.number().optional(),
  rainNext3Hours: z.number().optional(),
  snowNext3Hours: z.number().optional(),
});

export const WeatherForecastSchema = z.object({
  requestedLocation: z.string(),
  resolvedLocation: z.string(),
  country: z.string().optional(),
  coordinates: CoordinatesSchema,
  units: WeatherUnitsSchema,
  target: z.object({
    localDate: z.string().optional(),
    daysFromNow: z.number().optional(),
    timeOfDay: WeatherForecastTimeOfDaySchema.optional(),
    hour: z.number().optional(),
  }),
  availableRange: z.object({
    fromLocal: z.string(),
    toLocal: z.string(),
  }),
  selectedPoint: WeatherForecastPointSchema,
  points: z.array(WeatherForecastPointSchema),
});

export const LocalTimeSchema = z.object({
  requestedLocation: z.string(),
  resolvedLocation: z.string(),
  country: z.string().optional(),
  coordinates: CoordinatesSchema,
  localDate: z.string(),
  localTime: z.string(),
  localDateTime: z.string(),
  utcOffset: z.string(),
  utcOffsetSeconds: z.number(),
  calculatedAt: z.string(),
});

export const WeatherFailureReasonSchema = z.enum([
  'missing_api_key',
  'location_not_found',
  'geocoding_failed',
  'weather_fetch_failed',
  'forecast_target_unavailable',
]);

import { z } from 'zod';

export const WeatherUnitsSchema = z.enum(['metric', 'imperial']);
export const WeatherForecastTimeOfDaySchema = z.enum(['morning', 'afternoon', 'evening', 'night']);
const WeatherRequestTypeSchema = z.enum(['current', 'forecast']);

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

const WeatherFailureReasonSchema = z.enum([
  'missing_api_key',
  'location_not_found',
  'geocoding_failed',
  'weather_fetch_failed',
  'forecast_target_unavailable',
]);

export const GetWeatherToolInputSchema = z.object({
  location: z
    .string()
    .min(1)
    .describe(
      'City name to retrieve weather for. Must be explicit or come from a remembered default weather city. Include country only if needed for disambiguation.',
    ),
  units: WeatherUnitsSchema.optional().describe(
    "Use 'metric' by default unless the user explicitly asks for Fahrenheit/imperial units.",
  ),
  requestType: WeatherRequestTypeSchema.optional().describe(
    "Use 'current' for weather now. Use 'forecast' for future weather questions such as tomorrow, in 3 days, tonight, or this weekend.",
  ),
  forecast: z
    .object({
      daysFromNow: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe(
          "Relative forecast day. Use 1 for tomorrow, 3 for 'in 3 days'. OpenWeather free forecast only covers about 5 days.",
        ),
      targetLocalDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Target date in the forecast city local date, formatted YYYY-MM-DD.'),
      timeOfDay: WeatherForecastTimeOfDaySchema.optional().describe(
        'Optional broad target time for forecast questions. Defaults to midday if absent.',
      ),
      hour: z
        .number()
        .int()
        .min(0)
        .max(23)
        .optional()
        .describe('Optional forecast-city local hour to select the closest 3-hour forecast point.'),
    })
    .optional(),
});

export const GetWeatherToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  requestType: WeatherRequestTypeSchema.optional(),
  weather: CurrentWeatherSchema.optional(),
  forecast: WeatherForecastSchema.optional(),
  reason: WeatherFailureReasonSchema.optional(),
});

export const GetLocalTimeToolInputSchema = z.object({
  location: z
    .string()
    .min(1)
    .describe(
      'City or place to retrieve current local date and time for. Must be explicit or come from a remembered default/native location.',
    ),
});

export const GetLocalTimeToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  localTime: LocalTimeSchema.optional(),
  reason: WeatherFailureReasonSchema.optional(),
});

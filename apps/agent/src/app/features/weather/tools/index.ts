import type { Tool } from 'ai';

import { tool } from 'ai';
import { z } from 'zod';

import { WeatherService } from '@/app/features/weather';
import {
  CurrentWeatherSchema,
  LocalTimeSchema,
  WeatherFailureReasonSchema,
  WeatherForecastSchema,
  WeatherForecastTimeOfDaySchema,
  WeatherUnitsSchema,
} from '@/app/features/weather/schemas';
import { logger } from '@/infrastructure/logger';

const WeatherRequestTypeSchema = z.enum(['current', 'forecast']);

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
  providerStatus: z.number().optional(),
  providerMessage: z.string().optional(),
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
  providerStatus: z.number().optional(),
  providerMessage: z.string().optional(),
});

export type GetWeatherTool = Tool<
  z.infer<typeof GetWeatherToolInputSchema>,
  z.infer<typeof GetWeatherToolOutputSchema>
>;

export type GetLocalTimeTool = Tool<
  z.infer<typeof GetLocalTimeToolInputSchema>,
  z.infer<typeof GetLocalTimeToolOutputSchema>
>;

const getProviderStatus = (result: object) =>
  'providerStatus' in result && typeof result.providerStatus === 'number'
    ? result.providerStatus
    : undefined;
const getProviderMessage = (result: object) =>
  'providerMessage' in result && typeof result.providerMessage === 'string'
    ? result.providerMessage
    : undefined;

export const getWeatherTool: GetWeatherTool = tool({
  description:
    'Get current weather or a 5-day / 3-hour forecast for a specific city using OpenWeather. Use forecast mode for future weather questions such as tomorrow, in 3 days, tonight, or this weekend. Forecast data is available for about 5 days ahead in 3-hour steps. Use this only after resolving a city from the user message or remembered default weather city. Do not ask for ZIP/post code. Do not guess home/native location. If no location is known, ask the user which city to use before calling this tool.',
  inputSchema: GetWeatherToolInputSchema,
  outputSchema: GetWeatherToolOutputSchema,
  execute: async ({ location, units = 'metric', requestType = 'current', forecast }) => {
    if (requestType === 'forecast') {
      const result = await WeatherService.getForecastWeather({
        location,
        units,
        daysFromNow: forecast?.daysFromNow,
        targetLocalDate: forecast?.targetLocalDate,
        timeOfDay: forecast?.timeOfDay,
        hour: forecast?.hour,
      });

      logger.info(
        {
          location,
          units,
          requestType,
          forecast,
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
          message: result.ok ? undefined : result.message,
          providerStatus: result.ok ? undefined : getProviderStatus(result),
          providerMessage: result.ok ? undefined : getProviderMessage(result),
        },
        '[WEATHER]: tool executed',
      );

      if (!result.ok) {
        return {
          ok: false,
          requestType,
          message: result.message,
          reason: result.reason,
          providerStatus: getProviderStatus(result),
          providerMessage: getProviderMessage(result),
        };
      }

      return {
        ok: true,
        requestType,
        message: `Weather forecast loaded for ${result.forecast.resolvedLocation}.`,
        forecast: result.forecast,
      };
    }

    const result = await WeatherService.getCurrentWeather({ location, units });

    logger.info(
      {
        location,
        units,
        requestType,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
        message: result.ok ? undefined : result.message,
        providerStatus: result.ok ? undefined : getProviderStatus(result),
        providerMessage: result.ok ? undefined : getProviderMessage(result),
      },
      '[WEATHER]: tool executed',
    );

    if (!result.ok) {
      return {
        ok: false,
        requestType,
        message: result.message,
        reason: result.reason,
        providerStatus: getProviderStatus(result),
        providerMessage: getProviderMessage(result),
      };
    }

    return {
      ok: true,
      requestType,
      message: `Current weather loaded for ${result.weather.resolvedLocation}.`,
      weather: result.weather,
    };
  },
});

export const getLocalTimeTool: GetLocalTimeTool = tool({
  description:
    'Get the current local date and time for a specific city/place. Use this for questions such as "what time is it in Tokyo?" or "what is the date there?". If the user asks for the time without a city/place, use a remembered default/native location when present. If no default/native location is known, ask which city to use. Do not guess location from timezone, Telegram metadata, IP, or locale.',
  inputSchema: GetLocalTimeToolInputSchema,
  outputSchema: GetLocalTimeToolOutputSchema,
  execute: async ({ location }) => {
    const result = await WeatherService.getLocalTime({ location });

    logger.info(
      {
        location,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
        message: result.ok ? undefined : result.message,
        providerStatus: result.ok ? undefined : getProviderStatus(result),
        providerMessage: result.ok ? undefined : getProviderMessage(result),
      },
      '[LOCAL_TIME]: tool executed',
    );

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        reason: result.reason,
        providerStatus: getProviderStatus(result),
        providerMessage: getProviderMessage(result),
      };
    }

    return {
      ok: true,
      message: `Local time loaded for ${result.localTime.resolvedLocation}.`,
      localTime: result.localTime,
    };
  },
});

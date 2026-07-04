import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';

import { WeatherService } from '@/app/features/weather';
import {
  GetLocalTimeToolInputSchema,
  GetLocalTimeToolOutputSchema,
  GetWeatherToolInputSchema,
  GetWeatherToolOutputSchema,
} from '@/app/features/weather/schemas';
import { logger } from '@/infrastructure/logger';

export type GetWeatherTool = Tool<
  z.infer<typeof GetWeatherToolInputSchema>,
  z.infer<typeof GetWeatherToolOutputSchema>
>;

export type GetLocalTimeTool = Tool<
  z.infer<typeof GetLocalTimeToolInputSchema>,
  z.infer<typeof GetLocalTimeToolOutputSchema>
>;

const _getProviderStatus = (result: object) =>
  'providerStatus' in result && typeof result.providerStatus === 'number'
    ? result.providerStatus
    : undefined;
const _getProviderMessage = (result: object) =>
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
          providerStatus: result.ok ? undefined : _getProviderStatus(result),
          providerMessage: result.ok ? undefined : _getProviderMessage(result),
        },
        '[WEATHER]: tool executed',
      );

      if (!result.ok) {
        return {
          ok: false,
          requestType,
          message: result.message,
          reason: result.reason,
          providerStatus: _getProviderStatus(result),
          providerMessage: _getProviderMessage(result),
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
        providerStatus: result.ok ? undefined : _getProviderStatus(result),
        providerMessage: result.ok ? undefined : _getProviderMessage(result),
      },
      '[WEATHER]: tool executed',
    );

    if (!result.ok) {
      return {
        ok: false,
        requestType,
        message: result.message,
        reason: result.reason,
        providerStatus: _getProviderStatus(result),
        providerMessage: _getProviderMessage(result),
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
        providerStatus: result.ok ? undefined : _getProviderStatus(result),
        providerMessage: result.ok ? undefined : _getProviderMessage(result),
      },
      '[LOCAL_TIME]: tool executed',
    );

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        reason: result.reason,
        providerStatus: _getProviderStatus(result),
        providerMessage: _getProviderMessage(result),
      };
    }

    return {
      ok: true,
      message: `Local time loaded for ${result.localTime.resolvedLocation}.`,
      localTime: result.localTime,
    };
  },
});

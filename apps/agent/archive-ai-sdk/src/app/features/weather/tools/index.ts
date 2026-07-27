import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import { WeatherService } from '@/app/features/weather';
import {
  GetLocalTimeToolInputSchema,
  GetLocalTimeToolOutputSchema,
  GetWeatherToolInputSchema,
  GetWeatherToolOutputSchema,
} from '@/app/features/weather/schemas';
import { logger } from '@/infrastructure/logger';

export const getWeatherTool: GetWeatherTool = tool({
  description: dedent`
    Get current weather or a 5-day / 3-hour forecast for a resolved city using OpenWeather.

    # When To Use
    - The user asks for current weather, temperature, wind, rain, snow, or conditions in a city.
    - The user asks for near-future weather such as tomorrow, tonight, this weekend, or in up to 5 days.
    - A remembered default/native weather city is visible in durable knowledge and the user asks weather without naming a city.

    # When Not To Use
    - The user asks only for local date/time; use get-local-time.
    - The user asks for climate averages, historical weather, or forecasts beyond about 5 days; explain the limitation instead.
    - The city is unknown and no remembered default/native weather city is visible; ask which city to use.

    # Do Not Use For
    - Guessing home/default location from timezone, Telegram metadata, IP, locale, or previous one-off requests.
    - ZIP/postal-code lookup.
    - Mutating the user's remembered default city.

    # Usage
    - Use requestType "current" for weather now.
    - Use requestType "forecast" for future weather questions.
    - Use metric units by default unless the user asks for Fahrenheit/imperial.
    - For relative dates, pass daysFromNow. For broad times, pass timeOfDay. For exact local hours, pass hour.
    - After ok=true, answer from weather/forecast fields directly. Do not say only that weather was loaded.
    - After ok=false, give the returned safe failure briefly.

    # Examples
    - "Weather in Warsaw?" -> current, location Warsaw.
    - "Will it rain in Tokyo tomorrow evening?" -> forecast, location Tokyo, daysFromNow 1, timeOfDay evening.
    - "Weather tomorrow?" with no known default city -> ask for the city before calling.
  `,
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
          units,
          requestType,
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
        },
        '[WEATHER]: tool executed',
      );

      if (!result.ok) {
        return {
          ok: false,
          requestType,
          message: result.message,
          reason: result.reason,
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
        units,
        requestType,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
      },
      '[WEATHER]: tool executed',
    );

    if (!result.ok) {
      return {
        ok: false,
        requestType,
        message: result.message,
        reason: result.reason,
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

export type GetWeatherTool = Tool<
  z.infer<typeof GetWeatherToolInputSchema>,
  z.infer<typeof GetWeatherToolOutputSchema>
>;

export type GetLocalTimeTool = Tool<
  z.infer<typeof GetLocalTimeToolInputSchema>,
  z.infer<typeof GetLocalTimeToolOutputSchema>
>;

export const getLocalTimeTool: GetLocalTimeTool = tool({
  description: dedent`
    Get the current local date, time, and UTC offset for a resolved city or place.

    # When To Use
    - The user asks what time or date it is in a city/place.
    - The user asks for current time/date without a city and a remembered default/native location is visible.
    - The user asks follow-up time/date questions where the referenced place is clear from recent context.

    # When Not To Use
    - The user asks for weather; use get-weather.
    - The user asks for scheduled reminders or future jobs; use the scheduling flow when it exists.
    - No city/place is known; ask which city to use.

    # Do Not Use For
    - Guessing location from timezone, Telegram metadata, IP, locale, or previous one-off requests.
    - Mutating remembered default/native location.

    # Usage
    - Pass an explicit city/place or a remembered default/native location.
    - If the user provides a one-off city, use it only for this request.
    - After ok=true, answer with the resolved local date/time and UTC offset when useful.
    - After ok=false, ask for a clearer city/place or state the returned safe limitation.

    # Examples
    - "What time is it in Tokyo?" -> location Tokyo.
    - "What date is it there?" after discussing Lisbon -> location Lisbon.
    - "What time is it?" with no known default location -> ask for the city.
  `,
  inputSchema: GetLocalTimeToolInputSchema,
  outputSchema: GetLocalTimeToolOutputSchema,
  execute: async ({ location }) => {
    const result = await WeatherService.getLocalTime({ location });

    logger.info(
      {
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
      },
      '[LOCAL_TIME]: tool executed',
    );

    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        reason: result.reason,
      };
    }

    return {
      ok: true,
      message: `Local time loaded for ${result.localTime.resolvedLocation}.`,
      localTime: result.localTime,
    };
  },
});

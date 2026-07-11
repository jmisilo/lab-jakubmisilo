import type {
  OpenWeatherCurrentResponse,
  OpenWeatherForecastPoint,
  OpenWeatherForecastResponse,
  OpenWeatherGeocodingResult,
} from '@/infrastructure/openweather';
import type { z } from 'zod';

import {
  CurrentWeatherSchema,
  LocalTimeSchema,
  WeatherForecastPointSchema,
  WeatherForecastSchema,
  WeatherForecastTimeOfDaySchema,
  WeatherUnitsSchema,
} from '@/app/features/weather/schemas';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { OpenWeatherClient } from '@/infrastructure/openweather';

export class WeatherService {
  static async getCurrentWeather({
    location,
    units = 'metric',
  }: {
    location: string;
    units?: WeatherUnits;
  }) {
    const unitSystem = WeatherUnitsSchema.parse(units);
    const geocodingResult = await this.#findLocation({ location });

    if (!geocodingResult.ok) {
      return geocodingResult;
    }

    const weatherResult = await this.#fetchCurrentWeather({
      location,
      resolvedLocation: geocodingResult.location,
      units: unitSystem,
    });

    return weatherResult;
  }

  static async getForecastWeather({
    location,
    units = 'metric',
    daysFromNow,
    targetLocalDate,
    timeOfDay,
    hour,
    now = new Date(),
  }: {
    location: string;
    units?: WeatherUnits;
    daysFromNow?: number;
    targetLocalDate?: string;
    timeOfDay?: WeatherForecastTimeOfDay;
    hour?: number;
    now?: Date;
  }) {
    const unitSystem = WeatherUnitsSchema.parse(units);
    const geocodingResult = await this.#findLocation({ location });

    if (!geocodingResult.ok) {
      return geocodingResult;
    }

    return this.#fetchForecastWeather({
      location,
      resolvedLocation: geocodingResult.location,
      units: unitSystem,
      target: {
        daysFromNow,
        targetLocalDate,
        timeOfDay,
        hour,
      },
      now,
    });
  }

  static async getLocalTime({ location, now = new Date() }: { location: string; now?: Date }) {
    const geocodingResult = await this.#findLocation({ location });

    if (!geocodingResult.ok) {
      return geocodingResult;
    }

    return this.#fetchLocalTime({
      location,
      resolvedLocation: geocodingResult.location,
      now,
    });
  }

  static async #findLocation({ location }: { location: string }) {
    try {
      const matchedLocation = await OpenWeatherClient.findLocation(location);

      if (!matchedLocation) {
        return {
          ok: false as const,
          reason: 'location_not_found' as const,
          message: `Could not resolve weather location "${location}".`,
        };
      }

      return {
        ok: true as const,
        location: matchedLocation,
      };
    } catch (error) {
      return this.#createFailureResult({
        error,
        reason: 'geocoding_failed',
        fallbackMessage: `Could not resolve weather location "${location}".`,
      });
    }
  }

  static async #fetchCurrentWeather({
    location,
    resolvedLocation,
    units,
  }: {
    location: string;
    resolvedLocation: OpenWeatherGeocodingResult;
    units: WeatherUnits;
  }) {
    try {
      const weather = await OpenWeatherClient.getCurrentWeather({
        latitude: resolvedLocation.lat,
        longitude: resolvedLocation.lon,
        units,
      });

      return {
        ok: true as const,
        weather: this.#toCurrentWeather({
          requestedLocation: location,
          resolvedLocation,
          weather,
          units,
        }),
      };
    } catch (error) {
      return this.#createFailureResult({
        error,
        reason: 'weather_fetch_failed',
        fallbackMessage: `Could not fetch current weather for "${location}".`,
      });
    }
  }

  static async #fetchForecastWeather({
    location,
    resolvedLocation,
    units,
    target,
    now,
  }: {
    location: string;
    resolvedLocation: OpenWeatherGeocodingResult;
    units: WeatherUnits;
    target: {
      daysFromNow?: number;
      targetLocalDate?: string;
      timeOfDay?: WeatherForecastTimeOfDay;
      hour?: number;
    };
    now: Date;
  }) {
    try {
      const forecast = await OpenWeatherClient.getForecast({
        latitude: resolvedLocation.lat,
        longitude: resolvedLocation.lon,
        units,
      });

      return {
        ok: true as const,
        forecast: this.#toWeatherForecast({
          requestedLocation: location,
          resolvedLocation,
          forecast,
          units,
          target,
          now,
        }),
      };
    } catch (error) {
      if (this.#isAppErrorCode(error, AppErrorCode.WEATHER_FORECAST_TARGET_UNAVAILABLE)) {
        const details = this.#getForecastTargetUnavailableDetails(error);

        return {
          ok: false as const,
          reason: 'forecast_target_unavailable' as const,
          message: [
            `Forecast for "${location}" is not available on ${details.targetLocalDate}.`,
            `Available forecast range is ${details.fromLocal} to ${details.toLocal}.`,
          ].join(' '),
        };
      }

      return this.#createFailureResult({
        error,
        reason: 'weather_fetch_failed',
        fallbackMessage: `Could not fetch weather forecast for "${location}".`,
      });
    }
  }

  static async #fetchLocalTime({
    location,
    resolvedLocation,
    now,
  }: {
    location: string;
    resolvedLocation: OpenWeatherGeocodingResult;
    now: Date;
  }) {
    try {
      const weather = await OpenWeatherClient.getCurrentWeather({
        latitude: resolvedLocation.lat,
        longitude: resolvedLocation.lon,
      });

      return {
        ok: true as const,
        localTime: this.#toLocalTime({
          requestedLocation: location,
          resolvedLocation,
          timezoneOffsetSeconds: weather.timezone,
          now,
        }),
      };
    } catch (error) {
      return this.#createFailureResult({
        error,
        reason: 'weather_fetch_failed',
        fallbackMessage: `Could not fetch local time for "${location}".`,
      });
    }
  }

  static #toCurrentWeather({
    requestedLocation,
    resolvedLocation,
    weather,
    units,
  }: {
    requestedLocation: string;
    resolvedLocation: OpenWeatherGeocodingResult;
    weather: OpenWeatherCurrentResponse;
    units: WeatherUnits;
  }): CurrentWeather {
    const [condition] = weather.weather;

    if (!condition) {
      throw new AppError({
        code: AppErrorCode.WEATHER_RESPONSE_INVALID,
        message: 'OpenWeather current weather response is missing weather condition.',
        context: {
          operation: 'openweather.current_weather.parse',
          field: 'weather[0]',
        },
      });
    }

    return {
      requestedLocation,
      resolvedLocation: this.#formatResolvedLocation(resolvedLocation),
      country: resolvedLocation.country,
      coordinates: {
        lat: resolvedLocation.lat,
        lon: resolvedLocation.lon,
      },
      units,
      temperature: weather.main.temp,
      feelsLike: weather.main.feels_like,
      humidity: weather.main.humidity,
      pressure: weather.main.pressure,
      description: condition.description,
      windSpeed: weather.wind.speed,
      windDirection: weather.wind.deg,
      cloudiness: weather.clouds.all,
      visibility: weather.visibility,
      rainLastHour: weather.rain?.['1h'],
      snowLastHour: weather.snow?.['1h'],
      observedAt: new Date(weather.dt * 1000).toISOString(),
    };
  }

  static #toWeatherForecast({
    requestedLocation,
    resolvedLocation,
    forecast,
    units,
    target,
    now,
  }: {
    requestedLocation: string;
    resolvedLocation: OpenWeatherGeocodingResult;
    forecast: OpenWeatherForecastResponse;
    units: WeatherUnits;
    target: {
      daysFromNow?: number;
      targetLocalDate?: string;
      timeOfDay?: WeatherForecastTimeOfDay;
      hour?: number;
    };
    now: Date;
  }): WeatherForecast {
    const points = forecast.list.map((point) =>
      this.#toWeatherForecastPoint(point, forecast.city.timezone),
    );
    const [firstPoint] = points;
    const lastPoint = points.at(-1);

    if (!firstPoint || !lastPoint) {
      throw new AppError({
        code: AppErrorCode.WEATHER_RESPONSE_INVALID,
        message: 'OpenWeather forecast response is missing forecast points.',
        context: {
          operation: 'openweather.forecast.parse',
          field: 'list',
        },
      });
    }

    const targetLocalDate =
      target.targetLocalDate ??
      (target.daysFromNow === undefined
        ? undefined
        : this.#addDaysToLocalDate({
            date: now,
            timezoneOffsetSeconds: forecast.city.timezone,
            days: target.daysFromNow,
          }));
    const targetHour = target.hour ?? this.#getPreferredForecastHour(target.timeOfDay);
    const matchingDayPoints = targetLocalDate
      ? points.filter((point) => point.localDate === targetLocalDate)
      : [];

    if (targetLocalDate && matchingDayPoints.length === 0) {
      throw new AppError({
        code: AppErrorCode.WEATHER_FORECAST_TARGET_UNAVAILABLE,
        message: 'Requested forecast target is outside the available OpenWeather range.',
        context: {
          targetLocalDate,
          fromLocal: firstPoint.forecastedAtLocal,
          toLocal: lastPoint.forecastedAtLocal,
        },
      });
    }

    const candidatePoints = matchingDayPoints.length > 0 ? matchingDayPoints : points;
    const selectedPoint = this.#selectClosestForecastPoint({
      points: candidatePoints,
      preferredHour: targetHour,
    });

    return {
      requestedLocation,
      resolvedLocation: this.#formatResolvedLocation(resolvedLocation),
      country: resolvedLocation.country,
      coordinates: {
        lat: resolvedLocation.lat,
        lon: resolvedLocation.lon,
      },
      units,
      target: {
        localDate: targetLocalDate,
        daysFromNow: target.daysFromNow,
        timeOfDay: target.timeOfDay,
        hour: target.hour,
      },
      availableRange: {
        fromLocal: firstPoint.forecastedAtLocal,
        toLocal: lastPoint.forecastedAtLocal,
      },
      selectedPoint,
      points: matchingDayPoints.length > 0 ? matchingDayPoints : points,
    };
  }

  static #toWeatherForecastPoint(
    point: OpenWeatherForecastPoint,
    timezoneOffsetSeconds: number,
  ): WeatherForecastPoint {
    const [condition] = point.weather;

    if (!condition) {
      throw new AppError({
        code: AppErrorCode.WEATHER_RESPONSE_INVALID,
        message: 'OpenWeather forecast point is missing weather condition.',
        context: {
          operation: 'openweather.forecast_point.parse',
          field: 'weather[0]',
        },
      });
    }

    const localDateTime = this.#toOffsetDateTime({
      timestampSeconds: point.dt,
      timezoneOffsetSeconds,
    });

    return {
      forecastedAt: new Date(point.dt * 1000).toISOString(),
      forecastedAtLocal: localDateTime.value,
      localDate: localDateTime.date,
      localHour: localDateTime.hour,
      temperature: point.main.temp,
      feelsLike: point.main.feels_like,
      humidity: point.main.humidity,
      pressure: point.main.pressure,
      description: condition.description,
      windSpeed: point.wind.speed,
      windDirection: point.wind.deg,
      cloudiness: point.clouds.all,
      visibility: point.visibility,
      precipitationProbability: point.pop,
      rainNext3Hours: point.rain?.['3h'],
      snowNext3Hours: point.snow?.['3h'],
    };
  }

  static #toLocalTime({
    requestedLocation,
    resolvedLocation,
    timezoneOffsetSeconds,
    now,
  }: {
    requestedLocation: string;
    resolvedLocation: OpenWeatherGeocodingResult;
    timezoneOffsetSeconds: number;
    now: Date;
  }): LocalTime {
    const localDateTime = this.#toOffsetDateTime({
      timestampSeconds: Math.floor(now.getTime() / 1000),
      timezoneOffsetSeconds,
    });

    return {
      requestedLocation,
      resolvedLocation: this.#formatResolvedLocation(resolvedLocation),
      country: resolvedLocation.country,
      coordinates: {
        lat: resolvedLocation.lat,
        lon: resolvedLocation.lon,
      },
      localDate: localDateTime.date,
      localTime: localDateTime.time,
      localDateTime: localDateTime.value,
      utcOffset: localDateTime.offset,
      utcOffsetSeconds: timezoneOffsetSeconds,
      calculatedAt: now.toISOString(),
    };
  }

  static #selectClosestForecastPoint({
    points,
    preferredHour,
  }: {
    points: WeatherForecastPoint[];
    preferredHour: number;
  }) {
    const [firstPoint] = points;

    if (!firstPoint) {
      throw new AppError({
        code: AppErrorCode.WEATHER_RESPONSE_INVALID,
        message: 'OpenWeather forecast selection has no candidate points.',
        context: {
          operation: 'openweather.forecast.select',
          field: 'points',
        },
      });
    }

    return points.reduce((bestPoint, point) =>
      Math.abs(point.localHour - preferredHour) < Math.abs(bestPoint.localHour - preferredHour)
        ? point
        : bestPoint,
    );
  }

  static #getPreferredForecastHour(timeOfDay?: WeatherForecastTimeOfDay) {
    if (timeOfDay === 'morning') {
      return 9;
    }

    if (timeOfDay === 'afternoon') {
      return 15;
    }

    if (timeOfDay === 'evening') {
      return 18;
    }

    if (timeOfDay === 'night') {
      return 21;
    }

    return 12;
  }

  static #addDaysToLocalDate({
    date,
    timezoneOffsetSeconds,
    days,
  }: {
    date: Date;
    timezoneOffsetSeconds: number;
    days: number;
  }) {
    const shifted = new Date(date.getTime() + timezoneOffsetSeconds * 1000);
    shifted.setUTCDate(shifted.getUTCDate() + days);

    return this.#formatUtcDate(shifted);
  }

  static #toOffsetDateTime({
    timestampSeconds,
    timezoneOffsetSeconds,
  }: {
    timestampSeconds: number;
    timezoneOffsetSeconds: number;
  }) {
    const shifted = new Date((timestampSeconds + timezoneOffsetSeconds) * 1000);
    const date = this.#formatUtcDate(shifted);
    const time = [shifted.getUTCHours(), shifted.getUTCMinutes()]
      .map((value) => value.toString().padStart(2, '0'))
      .join(':');
    const offset = this.#formatTimezoneOffset(timezoneOffsetSeconds);

    return {
      date,
      hour: shifted.getUTCHours(),
      time,
      offset,
      value: `${date} ${time} ${offset}`,
    };
  }

  static #formatUtcDate(date: Date) {
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
      .map((value, index) => (index === 0 ? value.toString() : value.toString().padStart(2, '0')))
      .join('-');
  }

  static #formatTimezoneOffset(timezoneOffsetSeconds: number) {
    const sign = timezoneOffsetSeconds >= 0 ? '+' : '-';
    const absoluteSeconds = Math.abs(timezoneOffsetSeconds);
    const hours = Math.floor(absoluteSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((absoluteSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');

    return `UTC${sign}${hours}:${minutes}`;
  }

  static #formatResolvedLocation(location: OpenWeatherGeocodingResult) {
    return [location.name, location.state, location.country].filter(Boolean).join(', ');
  }

  static #getForecastTargetUnavailableDetails(error: AppError) {
    return {
      targetLocalDate: this.#getStringContext(error, 'targetLocalDate') ?? 'the requested date',
      fromLocal: this.#getStringContext(error, 'fromLocal') ?? 'unknown',
      toLocal: this.#getStringContext(error, 'toLocal') ?? 'unknown',
    };
  }

  static #isAppErrorCode(error: unknown, code: AppErrorCode): error is AppError {
    return AppError.is(error) && error.code === code;
  }

  static #getStringContext(error: AppError, field: string) {
    const value = error.context[field];

    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  static #createFailureResult({
    error,
    reason,
    fallbackMessage,
  }: {
    error: unknown;
    reason: 'geocoding_failed' | 'weather_fetch_failed';
    fallbackMessage: string;
  }) {
    if (this.#isAppErrorCode(error, AppErrorCode.WEATHER_CONFIGURATION_INVALID)) {
      return {
        ok: false as const,
        reason: 'missing_api_key' as const,
        message: error.message,
      };
    }

    const failure = ErrorService.toUserFacingFailure(error, {
      fallbackCode: AppErrorCode.WEATHER_API_ERROR,
      fallbackMessage,
    });

    return {
      ok: false as const,
      reason,
      message: failure.message,
    };
  }
}

type WeatherUnits = z.infer<typeof WeatherUnitsSchema>;
type WeatherForecastTimeOfDay = z.infer<typeof WeatherForecastTimeOfDaySchema>;
type CurrentWeather = z.infer<typeof CurrentWeatherSchema>;
type WeatherForecastPoint = z.infer<typeof WeatherForecastPointSchema>;
type WeatherForecast = z.infer<typeof WeatherForecastSchema>;
type LocalTime = z.infer<typeof LocalTimeSchema>;

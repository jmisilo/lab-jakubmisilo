import type {
  CurrentWeather,
  LocalTime,
  OpenWeatherCurrentResponse,
  OpenWeatherForecastPoint,
  OpenWeatherForecastResponse,
  OpenWeatherGeocodingResult,
  WeatherForecast,
  WeatherForecastPoint,
  WeatherForecastTimeOfDay,
  WeatherUnits,
} from '@/app/features/weather/types';

import { UrlComposer } from '@labjm/utilities/url-composer';

import {
  OpenWeatherCurrentResponseSchema,
  OpenWeatherForecastResponseSchema,
  OpenWeatherGeocodingResponseSchema,
  WeatherUnitsSchema,
} from '@/app/features/weather/schemas';

class OpenWeatherApiError extends Error {
  constructor(
    message: string,
    readonly details: { status: number; providerMessage?: string },
  ) {
    super(message);
    this.name = 'OpenWeatherApiError';
  }
}

class WeatherForecastTargetUnavailableError extends Error {
  constructor(
    message: string,
    readonly details: { targetLocalDate: string; fromLocal: string; toLocal: string },
  ) {
    super(message);
    this.name = 'WeatherForecastTargetUnavailableError';
  }
}

export class WeatherService {
  static #timeout = 10_000;
  static #geocodingUrl = new UrlComposer('api.openweathermap.org', 'https');
  static #weatherUrl = new UrlComposer('api.openweathermap.org', 'https');

  static async getCurrentWeather({
    location,
    units = 'metric',
  }: {
    location: string;
    units?: WeatherUnits;
  }) {
    if (!process.env.OPENWEATHER_API_KEY) {
      return {
        ok: false as const,
        reason: 'missing_api_key' as const,
        message: 'OPENWEATHER_API_KEY is not configured.',
      };
    }

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
    if (!process.env.OPENWEATHER_API_KEY) {
      return {
        ok: false as const,
        reason: 'missing_api_key' as const,
        message: 'OPENWEATHER_API_KEY is not configured.',
      };
    }

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
    if (!process.env.OPENWEATHER_API_KEY) {
      return {
        ok: false as const,
        reason: 'missing_api_key' as const,
        message: 'OPENWEATHER_API_KEY is not configured.',
      };
    }

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
      const response = await this.#fetch(
        this.#geocodingUrl.compose({
          pathSegments: ['/geo', '/1.0', '/direct'],
          queryParams: {
            q: location.trim(),
            limit: 1,
            appid: process.env.OPENWEATHER_API_KEY,
          },
        }),
      );
      const [matchedLocation] = OpenWeatherGeocodingResponseSchema.parse(response);

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
      const providerDetails = this.#getProviderErrorDetails(error);

      return {
        ok: false as const,
        reason: 'geocoding_failed' as const,
        message: this.#createFailureMessage({
          fallback: `Could not resolve weather location "${location}".`,
          operation: 'OpenWeather geocoding request',
          providerDetails,
        }),
        providerStatus: providerDetails?.status,
        providerMessage: providerDetails?.providerMessage,
      };
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
      const response = await this.#fetch(
        this.#weatherUrl.compose({
          pathSegments: ['/data', '/2.5', '/weather'],
          queryParams: {
            lat: resolvedLocation.lat,
            lon: resolvedLocation.lon,
            appid: process.env.OPENWEATHER_API_KEY,
            units,
            lang: 'en',
          },
        }),
      );
      const weather = OpenWeatherCurrentResponseSchema.parse(response);

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
      const providerDetails = this.#getProviderErrorDetails(error);

      return {
        ok: false as const,
        reason: 'weather_fetch_failed' as const,
        message: this.#createFailureMessage({
          fallback: `Could not fetch current weather for "${location}".`,
          operation: 'OpenWeather weather request',
          providerDetails,
        }),
        providerStatus: providerDetails?.status,
        providerMessage: providerDetails?.providerMessage,
      };
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
      const response = await this.#fetch(
        this.#weatherUrl.compose({
          pathSegments: ['/data', '/2.5', '/forecast'],
          queryParams: {
            lat: resolvedLocation.lat,
            lon: resolvedLocation.lon,
            appid: process.env.OPENWEATHER_API_KEY,
            units,
            lang: 'en',
          },
        }),
      );
      const forecast = OpenWeatherForecastResponseSchema.parse(response);

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
      if (error instanceof WeatherForecastTargetUnavailableError) {
        return {
          ok: false as const,
          reason: 'forecast_target_unavailable' as const,
          message: [
            `Forecast for "${location}" is not available on ${error.details.targetLocalDate}.`,
            `Available forecast range is ${error.details.fromLocal} to ${error.details.toLocal}.`,
          ].join(' '),
        };
      }

      const providerDetails = this.#getProviderErrorDetails(error);

      return {
        ok: false as const,
        reason: 'weather_fetch_failed' as const,
        message: this.#createFailureMessage({
          fallback: `Could not fetch weather forecast for "${location}".`,
          operation: 'OpenWeather forecast request',
          providerDetails,
        }),
        providerStatus: providerDetails?.status,
        providerMessage: providerDetails?.providerMessage,
      };
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
      const response = await this.#fetch(
        this.#weatherUrl.compose({
          pathSegments: ['/data', '/2.5', '/weather'],
          queryParams: {
            lat: resolvedLocation.lat,
            lon: resolvedLocation.lon,
            appid: process.env.OPENWEATHER_API_KEY,
          },
        }),
      );
      const weather = OpenWeatherCurrentResponseSchema.parse(response);

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
      const providerDetails = this.#getProviderErrorDetails(error);

      return {
        ok: false as const,
        reason: 'weather_fetch_failed' as const,
        message: this.#createFailureMessage({
          fallback: `Could not fetch local time for "${location}".`,
          operation: 'OpenWeather local time request',
          providerDetails,
        }),
        providerStatus: providerDetails?.status,
        providerMessage: providerDetails?.providerMessage,
      };
    }
  }
  /** @todo provide better, typesafe solution for interactions with 3rd party apis */
  static async #fetch(url: string): Promise<unknown> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(new Error('openweather_api_timeout')),
      this.#timeout,
    );

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new OpenWeatherApiError('openweather_api_error', {
          status: response.status,
          providerMessage: await this.#readProviderErrorMessage(response),
        });
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
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
      throw new Error('openweather_current_weather_condition_missing');
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
      throw new Error('openweather_forecast_points_missing');
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
      throw new WeatherForecastTargetUnavailableError('openweather_forecast_target_unavailable', {
        targetLocalDate,
        fromLocal: firstPoint.forecastedAtLocal,
        toLocal: lastPoint.forecastedAtLocal,
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
      throw new Error('openweather_forecast_weather_condition_missing');
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
      throw new Error('openweather_forecast_candidates_missing');
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

  static async #readProviderErrorMessage(response: Response) {
    const text = await response.text().catch(() => '');

    if (!text) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(text) as { message?: unknown };

      return typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message
        : text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  }

  static #getProviderErrorDetails(error: unknown) {
    if (error instanceof OpenWeatherApiError) {
      return error.details;
    }

    return undefined;
  }

  static #createFailureMessage({
    fallback,
    operation,
    providerDetails,
  }: {
    fallback: string;
    operation: string;
    providerDetails?: { status: number; providerMessage?: string };
  }) {
    if (!providerDetails) {
      return fallback;
    }

    return [
      `${operation} failed with status ${providerDetails.status}.`,
      providerDetails.providerMessage,
    ]
      .filter(Boolean)
      .join(' ');
  }
}

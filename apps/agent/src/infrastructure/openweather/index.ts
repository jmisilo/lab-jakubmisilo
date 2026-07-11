import type { z } from 'zod';

import { UrlComposer } from '@labjm/utilities/url-composer';

import { AppError, AppErrorCode } from '@/infrastructure/errors';
import {
  OpenWeatherCurrentResponseSchema,
  OpenWeatherForecastPointSchema,
  OpenWeatherForecastResponseSchema,
  OpenWeatherGeocodingResponseSchema,
} from '@/infrastructure/openweather/schemas';

const OPENWEATHER_TIMEOUT_MS = 10_000;

export class OpenWeatherClient {
  static #url = new UrlComposer('api.openweathermap.org', 'https');

  static async findLocation(location: string) {
    const locations = await this.#request({
      operation: 'openweather.geocoding',
      pathSegments: ['/geo', '/1.0', '/direct'],
      query: {
        q: location.trim(),
        limit: 1,
      },
      schema: OpenWeatherGeocodingResponseSchema,
    });

    return locations[0] ?? null;
  }

  static getCurrentWeather({
    latitude,
    longitude,
    units,
  }: OpenWeatherCoordinates & { units?: 'metric' | 'imperial' }) {
    return this.#request({
      operation: 'openweather.current_weather',
      pathSegments: ['/data', '/2.5', '/weather'],
      query: {
        lat: latitude,
        lon: longitude,
        units,
        lang: units ? 'en' : undefined,
      },
      schema: OpenWeatherCurrentResponseSchema,
    });
  }

  static getForecast({
    latitude,
    longitude,
    units,
  }: OpenWeatherCoordinates & { units: 'metric' | 'imperial' }) {
    return this.#request({
      operation: 'openweather.forecast',
      pathSegments: ['/data', '/2.5', '/forecast'],
      query: {
        lat: latitude,
        lon: longitude,
        units,
        lang: 'en',
      },
      schema: OpenWeatherForecastResponseSchema,
    });
  }

  static async #request<Data>({
    operation,
    pathSegments,
    query,
    schema,
  }: {
    operation: string;
    pathSegments: string[];
    query: Record<string, string | number | undefined>;
    schema: z.ZodType<Data>;
  }) {
    const apiKey = this.#getApiKey();
    const url = this.#url.compose({
      pathSegments,
      queryParams: { ...query, appid: apiKey },
    });
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), OPENWEATHER_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        throw AppError.timeout({
          code: AppErrorCode.WEATHER_API_TIMEOUT,
          message: 'OpenWeather request timed out.',
          cause: error,
          context: { operation },
          timeoutMs: OPENWEATHER_TIMEOUT_MS,
          userMessage: 'Weather is temporarily unavailable. Please try again.',
        });
      }

      throw new AppError({
        code: AppErrorCode.WEATHER_API_ERROR,
        message: 'OpenWeather request failed before receiving a response.',
        cause: error,
        context: { operation },
        retryable: true,
        userMessage: 'Weather is temporarily unavailable. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AppError({
        code: AppErrorCode.WEATHER_API_ERROR,
        message: 'OpenWeather request failed.',
        context: {
          operation,
          providerStatus: response.status,
          providerMessage: await this.#readProviderErrorMessage(response),
        },
        retryable: response.status === 429 || response.status >= 500,
        userMessage: 'Weather is temporarily unavailable. Please try again.',
      });
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError({
        code: AppErrorCode.WEATHER_RESPONSE_INVALID,
        message: 'OpenWeather response was not valid JSON.',
        cause: error,
        context: { operation },
        retryable: false,
        userMessage: 'Weather is temporarily unavailable. Please try again.',
      });
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new AppError({
        code: AppErrorCode.WEATHER_RESPONSE_INVALID,
        message: 'OpenWeather response failed schema validation.',
        context: { operation, issues: parsed.error.issues },
        retryable: false,
        userMessage: 'Weather is temporarily unavailable. Please try again.',
      });
    }

    return parsed.data;
  }

  static #getApiKey() {
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (!apiKey) {
      throw new AppError({
        code: AppErrorCode.WEATHER_CONFIGURATION_INVALID,
        message: 'OPENWEATHER_API_KEY is not configured.',
        retryable: false,
        userMessage: 'Weather is not configured yet.',
      });
    }

    return apiKey;
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
}

export type OpenWeatherGeocodingResult = z.infer<typeof OpenWeatherGeocodingResponseSchema>[number];
export type OpenWeatherCurrentResponse = z.infer<typeof OpenWeatherCurrentResponseSchema>;
export type OpenWeatherForecastResponse = z.infer<typeof OpenWeatherForecastResponseSchema>;
export type OpenWeatherForecastPoint = z.infer<typeof OpenWeatherForecastPointSchema>;

type OpenWeatherCoordinates = {
  latitude: number;
  longitude: number;
};

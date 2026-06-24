import type {
  CurrentWeatherSchema,
  LocalTimeSchema,
  OpenWeatherCurrentResponseSchema,
  OpenWeatherForecastPointSchema,
  OpenWeatherForecastResponseSchema,
  OpenWeatherGeocodingResultSchema,
  WeatherFailureReasonSchema,
  WeatherForecastPointSchema,
  WeatherForecastSchema,
  WeatherForecastTimeOfDaySchema,
  WeatherUnitsSchema,
} from '@/app/features/weather/schemas';
import type { z } from 'zod';

export type WeatherUnits = z.infer<typeof WeatherUnitsSchema>;
export type WeatherForecastTimeOfDay = z.infer<typeof WeatherForecastTimeOfDaySchema>;

export type OpenWeatherGeocodingResult = z.infer<typeof OpenWeatherGeocodingResultSchema>;
export type OpenWeatherCurrentResponse = z.infer<typeof OpenWeatherCurrentResponseSchema>;
export type OpenWeatherForecastResponse = z.infer<typeof OpenWeatherForecastResponseSchema>;
export type OpenWeatherForecastPoint = z.infer<typeof OpenWeatherForecastPointSchema>;

export type CurrentWeather = z.infer<typeof CurrentWeatherSchema>;
export type WeatherForecastPoint = z.infer<typeof WeatherForecastPointSchema>;
export type WeatherForecast = z.infer<typeof WeatherForecastSchema>;
export type LocalTime = z.infer<typeof LocalTimeSchema>;

export type WeatherFailureReason = z.infer<typeof WeatherFailureReasonSchema>;

export type WeatherFailureResult = {
  ok: false;
  reason: WeatherFailureReason;
  message: string;
  providerStatus?: number;
  providerMessage?: string;
};

export type WeatherLookupResult =
  | {
      ok: true;
      weather: CurrentWeather;
    }
  | WeatherFailureResult;

export type WeatherForecastLookupResult =
  | {
      ok: true;
      forecast: WeatherForecast;
    }
  | WeatherFailureResult;

export type LocalTimeLookupResult =
  | {
      ok: true;
      localTime: LocalTime;
    }
  | WeatherFailureResult;

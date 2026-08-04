import {
  OpenWeatherCurrentResponseSchema,
  OpenWeatherForecastResponseSchema,
  OpenWeatherGeocodingResponseSchema,
  WeatherUnitsSchema,
} from './schemas';

const OPENWEATHER_API_URL = 'https://api.openweathermap.org';
const DEFAULT_FORECAST_HOUR = 12;

export class WeatherService {
  static async getCurrent(input: WeatherLocationInput) {
    const location = await this.#resolveLocation(input.location);
    const units = WeatherUnitsSchema.parse(input.units ?? 'metric');
    const weather = await this.#request(
      '/data/2.5/weather',
      {
        lat: location.latitude,
        lon: location.longitude,
        units,
      },
      OpenWeatherCurrentResponseSchema,
    );

    return {
      location: location.label,
      units,
      temperature: weather.main.temp,
      feelsLike: weather.main.feels_like,
      humidityPercent: weather.main.humidity,
      description: weather.weather[0]?.description ?? 'unknown',
      windSpeed: weather.wind.speed,
      rainLastHourMm: weather.rain?.['1h'],
      snowLastHourMm: weather.snow?.['1h'],
      observedAt: new Date(weather.dt * 1_000).toISOString(),
      localObservedAt: this.#formatAtOffset({
        date: new Date(weather.dt * 1_000),
        offsetSeconds: weather.timezone,
      }),
    };
  }

  static async getForecast(input: WeatherForecastInput) {
    const location = await this.#resolveLocation(input.location);
    const units = WeatherUnitsSchema.parse(input.units ?? 'metric');
    const forecast = await this.#request(
      '/data/2.5/forecast',
      {
        lat: location.latitude,
        lon: location.longitude,
        units,
      },
      OpenWeatherForecastResponseSchema,
    );
    const targetDate = this.#resolveTargetDate({
      targetLocalDate: input.targetLocalDate,
      daysFromNow: input.daysFromNow,
      offsetSeconds: forecast.city.timezone,
    });
    const dayPoints = forecast.list.filter(
      (point) =>
        this.#localDate({
          date: new Date(point.dt * 1_000),
          offsetSeconds: forecast.city.timezone,
        }) === targetDate,
    );

    if (dayPoints.length === 0) {
      throw new Error(`Weather forecast is unavailable for ${targetDate}.`);
    }

    const targetHour = input.targetHour ?? DEFAULT_FORECAST_HOUR;
    const selected = dayPoints.reduce((closest, point) => {
      const closestHour = this.#localHour({
        date: new Date(closest.dt * 1_000),
        offsetSeconds: forecast.city.timezone,
      });
      const pointHour = this.#localHour({
        date: new Date(point.dt * 1_000),
        offsetSeconds: forecast.city.timezone,
      });

      return Math.abs(pointHour - targetHour) < Math.abs(closestHour - targetHour)
        ? point
        : closest;
    });

    return {
      location: location.label,
      units,
      localDate: targetDate,
      selectedAt: this.#formatAtOffset({
        date: new Date(selected.dt * 1_000),
        offsetSeconds: forecast.city.timezone,
      }),
      temperature: selected.main.temp,
      feelsLike: selected.main.feels_like,
      minimumTemperature: Math.min(...dayPoints.map((point) => point.main.temp)),
      maximumTemperature: Math.max(...dayPoints.map((point) => point.main.temp)),
      humidityPercent: selected.main.humidity,
      description: selected.weather[0]?.description ?? 'unknown',
      windSpeed: selected.wind.speed,
      precipitationProbabilityPercent: Math.round(
        Math.max(...dayPoints.map((point) => point.pop)) * 100,
      ),
      rainTotalMm: this.#sum(dayPoints.map((point) => point.rain?.['3h'])),
      snowTotalMm: this.#sum(dayPoints.map((point) => point.snow?.['3h'])),
    };
  }

  static async getLocalTime({ location: requestedLocation }: { location: string }) {
    const location = await this.#resolveLocation(requestedLocation);
    const weather = await this.#request(
      '/data/2.5/weather',
      {
        lat: location.latitude,
        lon: location.longitude,
        units: 'metric',
      },
      OpenWeatherCurrentResponseSchema,
    );
    const now = new Date();

    return {
      location: location.label,
      localDateTime: this.#formatAtOffset({
        date: now,
        offsetSeconds: weather.timezone,
      }),
      utcDateTime: now.toISOString(),
      utcOffset: this.#formatOffset(weather.timezone),
    };
  }

  static async #resolveLocation(query: string) {
    const locations = await this.#request(
      '/geo/1.0/direct',
      {
        q: query,
        limit: 1,
      },
      OpenWeatherGeocodingResponseSchema,
    );
    const location = locations[0];

    if (!location) {
      throw new Error(`Could not find weather location "${query}".`);
    }

    return {
      latitude: location.lat,
      longitude: location.lon,
      label: [location.name, location.state, location.country].filter(Boolean).join(', '),
    };
  }

  static async #request<T>(
    path: string,
    query: Record<string, string | number>,
    schema: { parse(value: unknown): T },
  ) {
    const apiKey = process.env.OPENWEATHER_API_KEY?.trim();

    if (!apiKey) {
      throw new Error('Weather integration is not configured.');
    }

    const url = new URL(path, OPENWEATHER_API_URL);

    for (const [key, value] of Object.entries({ ...query, appid: apiKey })) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather provider returned HTTP ${response.status}.`);
    }

    return schema.parse(await response.json());
  }

  static #resolveTargetDate({
    targetLocalDate,
    daysFromNow = 0,
    offsetSeconds,
  }: {
    targetLocalDate?: string;
    daysFromNow?: number;
    offsetSeconds: number;
  }) {
    if (targetLocalDate) {
      return targetLocalDate;
    }

    const localNow = new Date(Date.now() + offsetSeconds * 1_000);
    localNow.setUTCDate(localNow.getUTCDate() + daysFromNow);

    return localNow.toISOString().slice(0, 10);
  }

  static #localDate({ date, offsetSeconds }: { date: Date; offsetSeconds: number }) {
    return new Date(date.getTime() + offsetSeconds * 1_000).toISOString().slice(0, 10);
  }

  static #localHour({ date, offsetSeconds }: { date: Date; offsetSeconds: number }) {
    return new Date(date.getTime() + offsetSeconds * 1_000).getUTCHours();
  }

  static #formatAtOffset({ date, offsetSeconds }: { date: Date; offsetSeconds: number }) {
    const localDate = new Date(date.getTime() + offsetSeconds * 1_000).toISOString().slice(0, 19);

    return `${localDate}${this.#formatOffset(offsetSeconds)}`;
  }

  static #formatOffset(offsetSeconds: number) {
    const sign = offsetSeconds >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(offsetSeconds) / 60;
    const hours = Math.floor(absoluteMinutes / 60);
    const minutes = absoluteMinutes % 60;

    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  static #sum(values: Array<number | undefined>) {
    const definedValues = values.filter((value): value is number => value !== undefined);

    return definedValues.length > 0
      ? Math.round(definedValues.reduce((sum, value) => sum + value, 0) * 10) / 10
      : undefined;
  }
}

type WeatherLocationInput = {
  location: string;
  units?: 'metric' | 'imperial';
};

type WeatherForecastInput = WeatherLocationInput & {
  daysFromNow?: number;
  targetLocalDate?: string;
  targetHour?: number;
};

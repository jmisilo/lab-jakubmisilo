import { WeatherService } from '.';

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENWEATHER_API_KEY;

describe('WeatherService', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENWEATHER_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  it('returns missing_api_key when OpenWeather credentials are absent', async () => {
    delete process.env.OPENWEATHER_API_KEY;

    await expect(WeatherService.getCurrentWeather({ location: 'Warsaw' })).resolves.toEqual({
      ok: false,
      reason: 'missing_api_key',
      message: 'OPENWEATHER_API_KEY is not configured.',
    });
  });

  it('geocodes the location and fetches current weather by coordinates', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: 'Warsaw',
            lat: 52.2297,
            lon: 21.0122,
            country: 'PL',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          weather: [{ id: 800, main: 'Clear', description: 'clear sky', icon: '01d' }],
          main: {
            temp: 21.4,
            feels_like: 20.8,
            pressure: 1017,
            humidity: 45,
          },
          visibility: 10000,
          wind: {
            speed: 3.2,
            deg: 270,
          },
          clouds: {
            all: 0,
          },
          dt: 1782295200,
          timezone: 7200,
        }),
      });

    global.fetch = fetchMock;

    await expect(WeatherService.getCurrentWeather({ location: 'Warsaw' })).resolves.toEqual({
      ok: true,
      weather: expect.objectContaining({
        requestedLocation: 'Warsaw',
        resolvedLocation: 'Warsaw, PL',
        country: 'PL',
        units: 'metric',
        temperature: 21.4,
        feelsLike: 20.8,
        humidity: 45,
        pressure: 1017,
        description: 'clear sky',
        windSpeed: 3.2,
        windDirection: 270,
        cloudiness: 0,
        visibility: 10000,
        observedAt: '2026-06-24T10:00:00.000Z',
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/geo/1.0/direct?q=Warsaw&limit=1&appid=test-api-key'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '/data/2.5/weather?lat=52.2297&lon=21.0122&appid=test-api-key&units=metric&lang=en',
      ),
      expect.any(Object),
    );
  });

  it('returns location_not_found when geocoding has no matches', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await expect(WeatherService.getCurrentWeather({ location: 'Atlantis' })).resolves.toEqual({
      ok: false,
      reason: 'location_not_found',
      message: 'Could not resolve weather location "Atlantis".',
    });
  });

  it('passes user-provided city and country names directly to geocoding', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: 'Rzeszów',
            lat: 50.0413,
            lon: 21.999,
            country: 'PL',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          weather: [{ id: 801, main: 'Clouds', description: 'few clouds', icon: '02d' }],
          main: {
            temp: 23,
            feels_like: 22.5,
            pressure: 1014,
            humidity: 52,
          },
          wind: {
            speed: 2.1,
          },
          clouds: {
            all: 20,
          },
          dt: 1782295200,
          timezone: 7200,
        }),
      });

    global.fetch = fetchMock;

    await WeatherService.getCurrentWeather({ location: 'Rzeszów, Poland' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        '/geo/1.0/direct?q=Rzesz%C3%B3w%2C+Poland&limit=1&appid=test-api-key',
      ),
      expect.any(Object),
    );
  });

  it('geocodes the location and fetches a forecast by coordinates', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: 'New York',
            lat: 40.7128,
            lon: -74.006,
            country: 'US',
            state: 'New York',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cnt: 3,
          city: {
            name: 'New York',
            country: 'US',
            timezone: -14400,
          },
          list: [
            createForecastPoint({ dt: 1782583200, temp: 24, description: 'clear sky' }),
            createForecastPoint({ dt: 1782594000, temp: 26, description: 'few clouds' }),
            createForecastPoint({
              dt: 1782604800,
              temp: 22,
              description: 'light rain',
              pop: 0.7,
              rainNext3Hours: 1.2,
            }),
          ],
        }),
      });

    global.fetch = fetchMock;

    await expect(
      WeatherService.getForecastWeather({
        location: 'New York',
        daysFromNow: 3,
        timeOfDay: 'evening',
        now: new Date('2026-06-24T15:00:00.000Z'),
      }),
    ).resolves.toEqual({
      ok: true,
      forecast: expect.objectContaining({
        requestedLocation: 'New York',
        resolvedLocation: 'New York, New York, US',
        country: 'US',
        units: 'metric',
        target: {
          daysFromNow: 3,
          localDate: '2026-06-27',
          timeOfDay: 'evening',
          hour: undefined,
        },
        availableRange: {
          fromLocal: '2026-06-27 14:00 UTC-04:00',
          toLocal: '2026-06-27 20:00 UTC-04:00',
        },
        selectedPoint: expect.objectContaining({
          forecastedAtLocal: '2026-06-27 17:00 UTC-04:00',
          temperature: 26,
          description: 'few clouds',
        }),
        points: expect.arrayContaining([
          expect.objectContaining({
            forecastedAtLocal: '2026-06-27 14:00 UTC-04:00',
          }),
        ]),
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '/data/2.5/forecast?lat=40.7128&lon=-74.006&appid=test-api-key&units=metric&lang=en',
      ),
      expect.any(Object),
    );
  });

  it('filters forecast points by explicit target local date when available', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: 'Warsaw',
            lat: 52.2297,
            lon: 21.0122,
            country: 'PL',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cnt: 3,
          city: {
            name: 'Warsaw',
            country: 'PL',
            timezone: 7200,
          },
          list: [
            createForecastPoint({ dt: 1782316800, temp: 20, description: 'clear sky' }),
            createForecastPoint({ dt: 1782403200, temp: 27, description: 'hot' }),
            createForecastPoint({ dt: 1782414000, temp: 21, description: 'storm' }),
          ],
        }),
      });

    await expect(
      WeatherService.getForecastWeather({
        location: 'Warsaw',
        targetLocalDate: '2026-06-25',
        hour: 18,
      }),
    ).resolves.toEqual({
      ok: true,
      forecast: expect.objectContaining({
        selectedPoint: expect.objectContaining({
          forecastedAtLocal: '2026-06-25 18:00 UTC+02:00',
          description: 'hot',
        }),
        points: [
          expect.objectContaining({
            localDate: '2026-06-25',
          }),
          expect.objectContaining({
            localDate: '2026-06-25',
          }),
        ],
      }),
    });
  });

  it('returns forecast_target_unavailable when the requested forecast date is outside the available range', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: 'Warsaw',
            lat: 52.2297,
            lon: 21.0122,
            country: 'PL',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cnt: 2,
          city: {
            name: 'Warsaw',
            country: 'PL',
            timezone: 7200,
          },
          list: [
            createForecastPoint({ dt: 1782316800, temp: 20, description: 'clear sky' }),
            createForecastPoint({ dt: 1782403200, temp: 27, description: 'hot' }),
          ],
        }),
      });

    await expect(
      WeatherService.getForecastWeather({
        location: 'Warsaw',
        targetLocalDate: '2026-07-10',
        hour: 12,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'forecast_target_unavailable',
      message:
        'Forecast for "Warsaw" is not available on 2026-07-10. Available forecast range is 2026-06-24 18:00 UTC+02:00 to 2026-06-25 18:00 UTC+02:00.',
    });
  });

  it('returns provider diagnostics when geocoding request fails', async () => {
    process.env.OPENWEATHER_API_KEY = 'bad-api-key';
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ cod: 401, message: 'Invalid API key' }),
    });

    await expect(
      WeatherService.getCurrentWeather({ location: 'Rzeszów, Poland' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'geocoding_failed',
      message: 'OpenWeather geocoding request failed with status 401. Invalid API key',
      providerStatus: 401,
      providerMessage: 'Invalid API key',
    });
  });

  it('geocodes the location and returns current local time', async () => {
    process.env.OPENWEATHER_API_KEY = 'test-api-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            name: 'New York',
            lat: 40.7128,
            lon: -74.006,
            country: 'US',
            state: 'New York',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          weather: [{ id: 800, main: 'Clear', description: 'clear sky', icon: '01d' }],
          main: {
            temp: 21,
            feels_like: 20,
            pressure: 1015,
            humidity: 50,
          },
          wind: {
            speed: 2,
          },
          clouds: {
            all: 0,
          },
          dt: 1782315420,
          timezone: -14400,
        }),
      });

    global.fetch = fetchMock;

    await expect(
      WeatherService.getLocalTime({
        location: 'New York',
        now: new Date('2026-06-24T15:45:00.000Z'),
      }),
    ).resolves.toEqual({
      ok: true,
      localTime: {
        requestedLocation: 'New York',
        resolvedLocation: 'New York, New York, US',
        country: 'US',
        coordinates: {
          lat: 40.7128,
          lon: -74.006,
        },
        localDate: '2026-06-24',
        localTime: '11:45',
        localDateTime: '2026-06-24 11:45 UTC-04:00',
        utcOffset: 'UTC-04:00',
        utcOffsetSeconds: -14400,
        calculatedAt: '2026-06-24T15:45:00.000Z',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/data/2.5/weather?lat=40.7128&lon=-74.006&appid=test-api-key'),
      expect.any(Object),
    );
  });
});

const createForecastPoint = ({
  dt,
  temp,
  description,
  pop,
  rainNext3Hours,
}: {
  dt: number;
  temp: number;
  description: string;
  pop?: number;
  rainNext3Hours?: number;
}) => ({
  dt,
  main: {
    temp,
    feels_like: temp - 0.5,
    pressure: 1015,
    humidity: 50,
  },
  weather: [{ id: 800, main: 'Clear', description, icon: '01d' }],
  clouds: {
    all: 10,
  },
  wind: {
    speed: 2.5,
    deg: 180,
  },
  visibility: 10000,
  pop,
  rain: rainNext3Hours === undefined ? undefined : { '3h': rainNext3Hours },
});

import { createTool } from '@mastra/core/tools';

import { WeatherService } from '.';
import { ReadLocalTimeInputSchema, ReadWeatherInputSchema } from './schemas';

export const readWeatherTool = createTool({
  id: 'read_weather',
  description:
    'Get current weather or a forecast for a resolved city/place. Use forecast mode for later today or a future date. Do not guess a location that is not explicit or present as a stable user default.',
  inputSchema: ReadWeatherInputSchema,
  execute: async ({ mode, ...input }) => {
    try {
      return {
        ok: true,
        weather:
          mode === 'current'
            ? await WeatherService.getCurrent(input)
            : await WeatherService.getForecast(input),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Weather could not be retrieved.',
      };
    }
  },
});

export const readLocalTimeTool = createTool({
  id: 'read_local_time',
  description:
    'Get the current local date, time, and UTC offset for an explicit city/place or a stable default location visible in user context.',
  inputSchema: ReadLocalTimeInputSchema,
  execute: async (input) => {
    try {
      return {
        ok: true,
        localTime: await WeatherService.getLocalTime(input),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Local time could not be retrieved.',
      };
    }
  },
});

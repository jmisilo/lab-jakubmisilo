import type { GetLocalTimeTool, GetWeatherTool } from '@/app/features/weather/tools';
import type {
  GetWorldCupContextTool,
  GetWorldCupTrackingTool,
  ManageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';

import { openai } from '@ai-sdk/openai';

import { getLocalTimeTool, getWeatherTool } from '@/app/features/weather/tools';
import {
  getWorldCupContextTool,
  getWorldCupTrackingTool,
  manageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';

export type AgentTools = {
  webSearch: ReturnType<typeof openai.tools.webSearch>;
  'manage-world-cup-subscription': ManageWorldCupSubscriptionTool;
  'get-world-cup-tracking': GetWorldCupTrackingTool;
  'get-world-cup-context': GetWorldCupContextTool;
  'get-weather': GetWeatherTool;
  'get-local-time': GetLocalTimeTool;
};

/** @todo defer loading tools, upon having multiple choices */
export const agentTools: AgentTools = {
  webSearch: openai.tools.webSearch({
    searchContextSize: 'medium',
  }),

  'manage-world-cup-subscription': manageWorldCupSubscriptionTool,
  'get-world-cup-tracking': getWorldCupTrackingTool,
  'get-world-cup-context': getWorldCupContextTool,
  'get-weather': getWeatherTool,
  'get-local-time': getLocalTimeTool,
};

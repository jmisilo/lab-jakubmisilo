import type { GetLocalTimeTool, GetWeatherTool } from '@/app/features/weather/tools';
import type {
  GetWorldCupContextTool,
  GetWorldCupTrackingTool,
  ManageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';
import type { ManageKnowledgeTool } from '@/app/knowledge/tools';
import type { ManageScheduleTool } from '@/app/schedules/tools';
import type { LoadSkillTool } from '@/app/skills/tools';

import { openai } from '@ai-sdk/openai';

import { getLocalTimeTool, getWeatherTool } from '@/app/features/weather/tools';
import {
  getWorldCupContextTool,
  getWorldCupTrackingTool,
  manageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';
import { manageKnowledgeTool } from '@/app/knowledge/tools';
import { manageScheduleTool } from '@/app/schedules/tools';
import { loadSkillTool } from '@/app/skills/tools';

/** @todo defer loading tools, upon having multiple choices */
export const agentTools: AgentTools = {
  'load-skill': loadSkillTool,
  webSearch: openai.tools.webSearch({
    searchContextSize: 'medium',
  }),

  'manage-knowledge': manageKnowledgeTool,
  'manage-schedule': manageScheduleTool,
  'manage-world-cup-subscription': manageWorldCupSubscriptionTool,
  'get-world-cup-tracking': getWorldCupTrackingTool,
  'get-world-cup-context': getWorldCupContextTool,
  'get-weather': getWeatherTool,
  'get-local-time': getLocalTimeTool,
};

export type AgentTools = {
  'load-skill': LoadSkillTool;
  webSearch: ReturnType<typeof openai.tools.webSearch>;
  'manage-knowledge': ManageKnowledgeTool;
  'manage-schedule': ManageScheduleTool;
  'manage-world-cup-subscription': ManageWorldCupSubscriptionTool;
  'get-world-cup-tracking': GetWorldCupTrackingTool;
  'get-world-cup-context': GetWorldCupContextTool;
  'get-weather': GetWeatherTool;
  'get-local-time': GetLocalTimeTool;
};

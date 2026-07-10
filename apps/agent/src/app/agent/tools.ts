import type { ManageCalendarTool, ReadCalendarTool } from '@/app/features/google/calendar/tools';
import type { ReadGmailTool } from '@/app/features/google/gmail/tools';
import type { ManageGoogleConnectionTool } from '@/app/features/google/tools';
import type { GetLocalTimeTool, GetWeatherTool } from '@/app/features/weather/tools';
import type {
  GetWorldCupContextTool,
  GetWorldCupTrackingTool,
  ManageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';
import type { ManageKnowledgeTool, ReadKnowledgeTool } from '@/app/knowledge/tools';
import type { ManageScheduleTool } from '@/app/schedules/tools';
import type { LoadSkillTool } from '@/app/skills/tools';

import { openai } from '@ai-sdk/openai';

import { manageCalendarTool, readCalendarTool } from '@/app/features/google/calendar/tools';
import { readGmailTool } from '@/app/features/google/gmail/tools';
import { manageGoogleConnectionTool } from '@/app/features/google/tools';
import { getLocalTimeTool, getWeatherTool } from '@/app/features/weather/tools';
import {
  getWorldCupContextTool,
  getWorldCupTrackingTool,
  manageWorldCupSubscriptionTool,
} from '@/app/features/world-cup/tools';
import { manageKnowledgeTool, readKnowledgeTool } from '@/app/knowledge/tools';
import { manageScheduleTool } from '@/app/schedules/tools';
import { loadSkillTool } from '@/app/skills/tools';

/** @todo defer loading tools, upon having multiple choices */
export const agentTools: AgentTools = {
  'load-skill': loadSkillTool,
  webSearch: openai.tools.webSearch({
    searchContextSize: 'medium',
  }),

  'read-knowledge': readKnowledgeTool,
  'manage-knowledge': manageKnowledgeTool,
  'manage-google-connection': manageGoogleConnectionTool,
  'read-calendar': readCalendarTool,
  'read-gmail': readGmailTool,
  'manage-calendar': manageCalendarTool,
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
  'read-knowledge': ReadKnowledgeTool;
  'manage-knowledge': ManageKnowledgeTool;
  'manage-google-connection': ManageGoogleConnectionTool;
  'read-calendar': ReadCalendarTool;
  'read-gmail': ReadGmailTool;
  'manage-calendar': ManageCalendarTool;
  'manage-schedule': ManageScheduleTool;
  'manage-world-cup-subscription': ManageWorldCupSubscriptionTool;
  'get-world-cup-tracking': GetWorldCupTrackingTool;
  'get-world-cup-context': GetWorldCupContextTool;
  'get-weather': GetWeatherTool;
  'get-local-time': GetLocalTimeTool;
};

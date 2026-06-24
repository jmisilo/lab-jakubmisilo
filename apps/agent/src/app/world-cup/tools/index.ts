import type { WorldCupEventType, WorldCupTrackingMode } from '@/app/world-cup/types';
import type { Tool } from 'ai';

import { tool } from 'ai';
import { z } from 'zod';

import { WORLD_CUP_TEAM_FIFA_CODES } from '@/app/world-cup/teams';
import { WorldCupSubscriptionService } from '@/app/world-cup/tracking/subscription';
import { WORLD_CUP_EVENT_TYPES } from '@/app/world-cup/types';
import { logger } from '@/infrastructure/logger';

export const ManageWorldCupSubscriptionToolInputSchema = z.object({
  action: z
    .enum(['subscribe', 'unsubscribe'])
    .describe('Whether to create/update a subscription or remove existing subscriptions.'),
  trackingMode: z
    .enum(['all_teams', 'teams', 'team'])
    .optional()
    .describe(
      "Use 'all_teams' for entire World Cup requests. Use 'teams' for a set of requested teams. Use 'team' for exactly one requested team.",
    ),
  teamCodes: z
    .array(z.enum(WORLD_CUP_TEAM_FIFA_CODES))
    .optional()
    .describe(
      "Three-letter FIFA team codes for 'team' and 'teams' tracking modes, for example ['POR'] or ['ENG', 'ESP'].",
    ),
  eventTypes: z
    .array(z.enum(WORLD_CUP_EVENT_TYPES))
    .optional()
    .describe(
      "Events to notify about. Use ['goal'] for goal-only requests. Use all event types when the user asks for all events.",
    ),
});

export const ManageWorldCupSubscriptionToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  subscriptionId: z.string().nullable().optional(),
  subscriptionIds: z.array(z.string()).optional(),
  deactivatedCount: z.number().optional(),
});

export const ManageWorldCupSubscriptionToolContextSchema = z.object({
  identityId: z.string(),
  threadId: z.string(),
  sourceMessageId: z.string().optional(),
});

export type ManageWorldCupSubscriptionTool = Tool<
  z.infer<typeof ManageWorldCupSubscriptionToolInputSchema>,
  z.infer<typeof ManageWorldCupSubscriptionToolOutputSchema>,
  z.infer<typeof ManageWorldCupSubscriptionToolContextSchema>
>;

export const manageWorldCupSubscriptionTool: ManageWorldCupSubscriptionTool = tool({
  description:
    "Create, update, or remove FIFA World Cup 2026 event notification subscriptions for this chat. Use explicit tracking modes: all_teams creates one subscription per World Cup team; teams creates one subscription for each requested team; team creates one subscription for exactly one requested team. Use only three-letter FIFA team codes in teamCodes. Team tracking always means events in that team's match, so 'England goals' includes goals scored by either team in England matches. A kickoff subscription sends both a 15-minute pre-kickoff reminder and a match-start notification. Examples: 'notify me about Portugal goals' => subscribe trackingMode team, teamCodes ['POR'], eventTypes goal; 'Portugal and Argentina goals' => subscribe trackingMode teams, teamCodes ['POR', 'ARG'], eventTypes goal; 'entire world cup' => subscribe trackingMode all_teams, eventTypes kickoff, goal, game_end; 'all Argentina events' => subscribe trackingMode team, teamCodes ['ARG'], eventTypes kickoff, goal, game_end; 'stop Portugal notifications' => unsubscribe trackingMode team, teamCodes ['POR'].",
  inputSchema: ManageWorldCupSubscriptionToolInputSchema,
  outputSchema: ManageWorldCupSubscriptionToolOutputSchema,
  contextSchema: ManageWorldCupSubscriptionToolContextSchema,
  execute: async ({ action, trackingMode = 'all_teams', teamCodes, eventTypes }, { context }) => {
    const resolvedTrackingMode = trackingMode as WorldCupTrackingMode;

    if (action === 'unsubscribe') {
      const result = await WorldCupSubscriptionService.unsubscribe({
        identityId: context.identityId,
        threadId: context.threadId,
        trackingMode: resolvedTrackingMode,
        teamCodes,
      });

      return {
        ok: result.ok,
        message: result.ok
          ? `Removed ${result.deactivatedCount} World Cup subscription(s).`
          : result.message,
        deactivatedCount: result.ok ? result.deactivatedCount : undefined,
      };
    }

    const resolvedEventTypes = (eventTypes ?? [...WORLD_CUP_EVENT_TYPES]) as WorldCupEventType[];
    const result = await WorldCupSubscriptionService.subscribe({
      identityId: context.identityId,
      threadId: context.threadId,
      sourceMessageId: context.sourceMessageId,
      trackingMode: resolvedTrackingMode,
      teamCodes,
      eventTypes: resolvedEventTypes,
    });

    logger.info(
      {
        identityId: context.identityId,
        threadId: context.threadId,
        trackingMode: resolvedTrackingMode,
        teamCodes,
        eventTypes: resolvedEventTypes,
        ok: result.ok,
      },
      '[WORLD_CUP]: subscription tool executed',
    );

    return {
      ok: result.ok,
      message: result.message,
      subscriptionId: result.ok ? (result.subscriptions.at(0)?.id ?? null) : null,
      subscriptionIds: result.ok
        ? result.subscriptions.map((subscription) => subscription.id)
        : undefined,
    };
  },
});

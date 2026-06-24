import type { WorldCupEventType, WorldCupTrackingMode } from '@/app/features/world-cup/types';
import type { Tool } from 'ai';

import { tool } from 'ai';
import { z } from 'zod';

import { WORLD_CUP_TEAM_FIFA_CODES } from '@/app/features/world-cup/teams';
import { WorldCupContextService } from '@/app/features/world-cup/tracking/context';
import { WorldCupSubscriptionService } from '@/app/features/world-cup/tracking/subscription';
import { WORLD_CUP_EVENT_TYPES } from '@/app/features/world-cup/types';
import { logger } from '@/infrastructure/logger';

const WORLD_CUP_CONTEXT_FOCUSES = [
  'all',
  'schedule',
  'team',
  'tables',
  'knockout',
  'stage',
] as const;

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

export const GetWorldCupContextToolInputSchema = z.object({
  focus: z
    .enum(WORLD_CUP_CONTEXT_FOCUSES)
    .optional()
    .describe(
      "Use 'schedule' for today's games or a specific date, 'team' for one or more teams, 'tables' for finished-game group tables, 'knockout' for the knockout ladder, 'stage' for current tournament phase, and 'all' when several views are useful.",
    ),
  teamCodes: z
    .array(z.enum(WORLD_CUP_TEAM_FIFA_CODES))
    .optional()
    .describe(
      "Three-letter FIFA team codes to narrow the context, for example ['POR'] or ['ESP'].",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Optional user-local date in YYYY-MM-DD format. Omit it for today.'),
});

const WorldCupContextTeamToolOutputSchema = z.object({
  name: z.string(),
  fifaCode: z.string().optional(),
  flagEmoji: z.string().optional(),
  score: z.number(),
});

const WorldCupContextGameToolOutputSchema = z.object({
  gameId: z.string(),
  stage: z.string(),
  group: z.string(),
  matchday: z.string(),
  status: z.enum(['scheduled', 'active', 'finished']),
  kickoffDate: z.string().nullable(),
  kickoffTime: z.string(),
  homeTeam: WorldCupContextTeamToolOutputSchema,
  awayTeam: WorldCupContextTeamToolOutputSchema,
  score: z.string(),
  winnerTeamId: z.string().optional(),
});

export const GetWorldCupContextToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  timeZone: z.string().optional(),
  generatedAt: z.string().optional(),
  today: z.string().optional(),
  currentStage: z.string().optional(),
  summaryMarkdown: z.string().optional(),
  scheduleMarkdown: z.string().optional(),
  groupTablesMarkdown: z.string().optional(),
  knockoutLadderMarkdown: z.string().optional(),
  games: z.array(WorldCupContextGameToolOutputSchema).optional(),
});

export const GetWorldCupContextToolContextSchema = z.object({
  timeZone: z.string(),
});

export type GetWorldCupContextTool = Tool<
  z.infer<typeof GetWorldCupContextToolInputSchema>,
  z.infer<typeof GetWorldCupContextToolOutputSchema>,
  z.infer<typeof GetWorldCupContextToolContextSchema>
>;

export const manageWorldCupSubscriptionTool: ManageWorldCupSubscriptionTool = tool({
  description:
    "Create, update, or remove FIFA World Cup 2026 event notification subscriptions for this chat. Only use this when the user explicitly asks to notify, alert, subscribe, unsubscribe, stop, or track future events. Do not use this for factual questions, schedules, tables, standings, brackets, or results; use get-world-cup-context instead. Use explicit tracking modes: all_teams creates one subscription per World Cup team; teams creates one subscription for each requested team; team creates one subscription for exactly one requested team. Use only three-letter FIFA team codes in teamCodes. Team tracking always means events in that team's match, so 'England goals' includes goals scored by either team in England matches. A kickoff subscription sends both a 15-minute pre-kickoff reminder and a match-start notification. Examples: 'notify me about Portugal goals' => subscribe trackingMode team, teamCodes ['POR'], eventTypes goal; 'Portugal and Argentina goals' => subscribe trackingMode teams, teamCodes ['POR', 'ARG'], eventTypes goal; 'entire world cup notifications' => subscribe trackingMode all_teams, eventTypes kickoff, goal, game-end; 'all Argentina alerts' => subscribe trackingMode team, teamCodes ['ARG'], eventTypes kickoff, goal, game-end; 'stop Portugal notifications' => unsubscribe trackingMode team, teamCodes ['POR'].",
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

export const getWorldCupContextTool: GetWorldCupContextTool = tool({
  description:
    "Read FIFA World Cup 2026 context for factual tournament questions. Use this for questions about today's games, kick-off times, a team's next game, current stage, group tables, standings, completed results, or the knockout ladder. Use this, not the subscription tool, when the user asks for a Portugal table, team table, group table, standings, schedule, result, or bracket. Times are formatted in the user's timezone from tool context. Do not use this tool to subscribe or unsubscribe notifications.",
  inputSchema: GetWorldCupContextToolInputSchema,
  outputSchema: GetWorldCupContextToolOutputSchema,
  contextSchema: GetWorldCupContextToolContextSchema,
  execute: async ({ focus = 'all', teamCodes, date }, { context }) => {
    try {
      const worldCupContext = await WorldCupContextService.getContext({
        timeZone: context.timeZone,
        focus,
        teamCodes,
        date,
      });

      logger.info(
        {
          focus,
          teamCodes,
          date,
          timeZone: worldCupContext.timeZone,
          games: worldCupContext.games.length,
        },
        '[WORLD_CUP]: context tool executed',
      );

      const includeSchedule = ['all', 'schedule', 'team'].includes(focus);
      const includeGroupTables = ['all', 'tables'].includes(focus);
      const includeKnockoutLadder = ['all', 'knockout'].includes(focus);
      const includeGames = ['all', 'schedule', 'team', 'knockout'].includes(focus);

      return {
        ok: true,
        message: 'World Cup context loaded.',
        timeZone: worldCupContext.timeZone,
        generatedAt: worldCupContext.generatedAt,
        today: worldCupContext.today,
        currentStage: worldCupContext.currentStage,
        summaryMarkdown: worldCupContext.summaryMarkdown,
        scheduleMarkdown: includeSchedule ? worldCupContext.scheduleMarkdown : undefined,
        groupTablesMarkdown: includeGroupTables ? worldCupContext.groupTablesMarkdown : undefined,
        knockoutLadderMarkdown: includeKnockoutLadder
          ? worldCupContext.knockoutLadderMarkdown
          : undefined,
        games: includeGames
          ? worldCupContext.games.map((game) => ({
              gameId: game.gameId,
              stage: game.stage,
              group: game.group,
              matchday: game.matchday,
              status: game.status,
              kickoffDate: game.kickoffDate,
              kickoffTime: game.kickoffTime,
              homeTeam: {
                name: game.homeTeam.name,
                fifaCode: game.homeTeam.fifaCode,
                flagEmoji: game.homeTeam.flagEmoji,
                score: game.homeTeam.score,
              },
              awayTeam: {
                name: game.awayTeam.name,
                fifaCode: game.awayTeam.fifaCode,
                flagEmoji: game.awayTeam.flagEmoji,
                score: game.awayTeam.score,
              },
              score: game.score,
              winnerTeamId: game.winnerTeamId,
            }))
          : undefined,
      };
    } catch (error) {
      logger.error({ error, focus, teamCodes, date }, '[WORLD_CUP]: context tool failed');

      return {
        ok: false,
        message: 'World Cup context is temporarily unavailable.',
      };
    }
  },
});

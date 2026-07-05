import type { WorldCupEventType, WorldCupTrackingMode } from '@/app/features/world-cup/types';
import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import {
  GetWorldCupContextToolContextSchema,
  GetWorldCupContextToolInputSchema,
  GetWorldCupContextToolOutputSchema,
  GetWorldCupTrackingToolContextSchema,
  GetWorldCupTrackingToolInputSchema,
  GetWorldCupTrackingToolOutputSchema,
  ManageWorldCupSubscriptionToolContextSchema,
  ManageWorldCupSubscriptionToolInputSchema,
  ManageWorldCupSubscriptionToolOutputSchema,
} from '@/app/features/world-cup/schemas';
import { WorldCupContextService } from '@/app/features/world-cup/tracking/context';
import { WorldCupSubscriptionService } from '@/app/features/world-cup/tracking/subscription';
import { WORLD_CUP_EVENT_TYPES } from '@/app/features/world-cup/types';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export type ManageWorldCupSubscriptionTool = Tool<
  z.infer<typeof ManageWorldCupSubscriptionToolInputSchema>,
  z.infer<typeof ManageWorldCupSubscriptionToolOutputSchema>,
  z.infer<typeof ManageWorldCupSubscriptionToolContextSchema>
>;

export type GetWorldCupTrackingTool = Tool<
  z.infer<typeof GetWorldCupTrackingToolInputSchema>,
  z.infer<typeof GetWorldCupTrackingToolOutputSchema>,
  z.infer<typeof GetWorldCupTrackingToolContextSchema>
>;

export type GetWorldCupContextTool = Tool<
  z.infer<typeof GetWorldCupContextToolInputSchema>,
  z.infer<typeof GetWorldCupContextToolOutputSchema>,
  z.infer<typeof GetWorldCupContextToolContextSchema>
>;

export const manageWorldCupSubscriptionTool: ManageWorldCupSubscriptionTool = tool({
  description: dedent`
    Create, update, or remove FIFA World Cup 2026 event notification subscriptions for this chat.

    # When To Use
    - The user explicitly asks to notify, alert, subscribe, unsubscribe, stop, or track future World Cup events.
    - The user asks for goal, kickoff, game-end, team, multi-team, or whole-tournament notifications.
    - The user changes notification scope for a team or the tournament.

    # When Not To Use
    - The user asks factual questions about schedules, tables, standings, results, brackets, or current stage; use get-world-cup-context.
    - The user asks what is already tracked; use get-world-cup-tracking.
    - The user casually mentions a team without asking for notifications.

    # Do Not Use For
    - Historical match facts or standings.
    - Guessing teams not named by the user.
    - Creating notification side effects for ambiguous requests.

    # Usage
    - trackingMode all_teams creates one subscription per World Cup team.
    - trackingMode teams creates one subscription for each requested team.
    - trackingMode team creates one subscription for exactly one requested team.
    - Use only three-letter FIFA team codes in teamCodes.
    - Team tracking means events in that team's match, so "England goals" includes goals by either team in England matches.
    - A kickoff subscription sends both a 15-minute pre-kickoff reminder and a match-start notification.

    # Examples
    - "Notify me about Portugal goals" -> subscribe, trackingMode team, teamCodes ["POR"], eventTypes ["goal"].
    - "Portugal and Argentina goals" -> subscribe, trackingMode teams, teamCodes ["POR", "ARG"], eventTypes ["goal"].
    - "Entire World Cup notifications" -> subscribe, trackingMode all_teams, eventTypes ["kickoff", "goal", "game-end"].
    - "Stop Portugal notifications" -> unsubscribe, trackingMode team, teamCodes ["POR"].
  `,
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

export const getWorldCupTrackingTool: GetWorldCupTrackingTool = tool({
  description: dedent`
    Read active FIFA World Cup 2026 notification tracking configured for this chat.

    # When To Use
    - The user asks what World Cup teams, events, subscriptions, alerts, or notifications are already being tracked.
    - The user asks for notification status or wants to verify current tracking before changing it.

    # When Not To Use
    - The user asks to create, update, stop, or remove notifications; use manage-world-cup-subscription.
    - The user asks factual tournament questions; use get-world-cup-context.

    # Do Not Use For
    - Mutating subscriptions.
    - Reading schedules, tables, standings, results, or brackets.

    # Usage
    - This tool is read-only.
    - Summarize the returned tracking status concisely for the user.
  `,
  inputSchema: GetWorldCupTrackingToolInputSchema,
  outputSchema: GetWorldCupTrackingToolOutputSchema,
  contextSchema: GetWorldCupTrackingToolContextSchema,
  execute: async (_input, { context }) => {
    try {
      const result = await WorldCupSubscriptionService.listTrackedSubscriptions({
        identityId: context.identityId,
        threadId: context.threadId,
      });

      logger.info(
        {
          identityId: context.identityId,
          threadId: context.threadId,
          subscriptionCount: result.subscriptions.length,
        },
        '[WORLD_CUP]: tracking tool executed',
      );

      return {
        ok: result.ok,
        message: result.message,
        summaryMarkdown: result.summaryMarkdown,
        subscriptions: result.subscriptions.map((subscription) => ({
          subscriptionId: subscription.subscriptionId,
          teamId: subscription.teamId,
          teamName: subscription.teamName,
          fifaCode: subscription.fifaCode,
          flagEmoji: subscription.flagEmoji,
          eventTypes: subscription.eventTypes,
          createdAt: subscription.createdAt.toISOString(),
          updatedAt: subscription.updatedAt.toISOString(),
        })),
      };
    } catch (error) {
      logger.error(
        {
          error,
          safeError: ErrorService.toSafeLog(error),
          identityId: context.identityId,
          threadId: context.threadId,
        },
        '[WORLD_CUP]: tracking tool failed',
      );

      return {
        ok: false,
        message: 'World Cup tracking status is temporarily unavailable.',
        summaryMarkdown: 'World Cup tracking status is temporarily unavailable.',
        subscriptions: [],
      };
    }
  },
});

export const getWorldCupContextTool: GetWorldCupContextTool = tool({
  description: dedent`
    Read FIFA World Cup 2026 context for factual tournament questions.

    # When To Use
    - The user asks about today's games, kickoff times, a team's next game, current stage, group tables, standings, completed results, or knockout ladder.
    - The user asks for a Portugal table, team table, group table, standings, schedule, result, or bracket.
    - The user needs tournament facts before deciding whether to subscribe to notifications.

    # When Not To Use
    - The user asks to notify, alert, subscribe, unsubscribe, stop, or track future events; use manage-world-cup-subscription.
    - The user asks what notifications are already configured; use get-world-cup-tracking.

    # Do Not Use For
    - Creating or removing notification subscriptions.
    - Guessing team codes not implied by the user's request.

    # Usage
    - Times are formatted in the user's timezone from tool context.
    - Use focus schedule for today's games or a specific date.
    - Use focus team when one or more teams are named.
    - Use focus tables for group tables, knockout for the bracket, stage for the current phase, and all when several views are useful.

    # Examples
    - "Who does Portugal play next?" -> focus team, teamCodes ["POR"].
    - "Today's World Cup games" -> focus schedule.
    - "Group tables" -> focus tables.
  `,
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
      logger.error(
        { error, safeError: ErrorService.toSafeLog(error), focus, teamCodes, date },
        '[WORLD_CUP]: context tool failed',
      );

      return {
        ok: false,
        message: 'World Cup context is temporarily unavailable.',
      };
    }
  },
});

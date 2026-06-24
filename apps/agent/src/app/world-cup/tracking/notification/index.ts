import type { ShortTermMemory } from '@/app/memory/types';
import type { WorldCupDetectedEvent } from '@/app/world-cup/types';
import type { Thread } from 'chat';

import dedent from 'dedent';

import { AIService } from '@/app/ai';
import { AgentMemoryService } from '@/app/memory';
import { AgentContextService } from '@/app/memory/context';
import { logger } from '@/infrastructure/logger';

export type WorldCupNotificationBot = {
  thread(threadId: string): Thread;
  transcripts: {
    list(input: { userKey: string; threadId: string; limit: number }): Promise<ShortTermMemory[]>;
  };
};

export class WorldCupNotificationService {
  static async postNotification({
    bot,
    event,
    identityId,
    threadId,
  }: {
    bot: WorldCupNotificationBot;
    event: WorldCupDetectedEvent;
    identityId: string;
    threadId: string;
  }) {
    logger.info(
      { eventKey: event.eventKey, identityId, threadId },
      '[WORLD_CUP]: composing notification',
    );
    const message = await this.composeNotification({ bot, event, identityId, threadId });
    logger.info(
      { eventKey: event.eventKey, threadId, messageLength: message.length },
      '[WORLD_CUP]: posting notification',
    );
    await bot.thread(threadId).post({ markdown: message });
  }

  private static async composeNotification({
    bot,
    event,
    identityId,
    threadId,
  }: {
    bot: WorldCupNotificationBot;
    event: WorldCupDetectedEvent;
    identityId: string;
    threadId: string;
  }) {
    try {
      const shortTermMemory = await bot.transcripts
        .list({
          userKey: identityId,
          threadId,
          limit: AgentContextService.contextSourceMessageLimit,
        })
        .catch((error: unknown) => {
          logger.warn(
            { error, identityId, threadId },
            '[WORLD_CUP]: transcript context unavailable',
          );
          return [];
        });
      const context = await AgentMemoryService.buildContext({
        identityId,
        threadId,
        shortTermMemory,
      });

      logger.debug(
        {
          eventKey: event.eventKey,
          identityId,
          threadId,
          shortTermMemoryCount: shortTermMemory.length,
          contextMessages: context.length,
        },
        '[WORLD_CUP]: notification context built',
      );

      return await AIService.generate({
        messages: [
          {
            role: 'system',
            content: dedent`
              Write a short Telegram notification for a FIFA World Cup 2026 event.
              Use the prior conversation only to match the user's tone and preferences.
              Do not invent football facts, times, scorers, teams, or scores.
              Use markdown only when helpful. Keep it direct and concise.
            `,
          },
          ...context,
          {
            role: 'user',
            content: dedent`
              Create the notification from this event payload:
              ${JSON.stringify(event.payload, null, 2)}
            `,
          },
        ],
        timeoutMs: 20_000,
      });
    } catch (error) {
      logger.error({ error, eventKey: event.eventKey }, '[WORLD_CUP]: AI notification failed');
      return this.createFallbackNotification(event);
    }
  }

  private static createFallbackNotification(event: WorldCupDetectedEvent) {
    const { payload } = event;

    if (payload.eventType === 'kickoff_reminder') {
      return `${payload.homeTeam.name} vs ${payload.awayTeam.name} kicks off in ${payload.minutesUntilKickoff ?? 15} minutes.`;
    }

    if (payload.eventType === 'kickoff') {
      return `Kickoff: ${payload.homeTeam.name} vs ${payload.awayTeam.name} has started.`;
    }

    if (payload.eventType === 'goal' && payload.scoringTeam) {
      const scorer = payload.scoringTeam.scorerName
        ? ` ${payload.scoringTeam.scorerName}${payload.scoringTeam.goalMinute ? ` ${payload.scoringTeam.goalMinute}'` : ''}.`
        : '';

      return `Goal for ${payload.scoringTeam.name}.${scorer} ${payload.matchLabel}.`;
    }

    return `Full time: ${payload.matchLabel}.`;
  }
}

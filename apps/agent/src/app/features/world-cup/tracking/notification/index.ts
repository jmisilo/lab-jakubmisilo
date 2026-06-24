import type { WorldCupDetectedEvent } from '@/app/features/world-cup/types';
import type { ShortTermMemory } from '@/app/memory/types';
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
    const message = await this.#composeNotification({
      bot,
      event,
      identityId,
      threadId,
    });
    logger.info(
      { eventKey: event.eventKey, threadId, messageLength: message.length },
      '[WORLD_CUP]: posting notification',
    );
    await bot.thread(threadId).post({ markdown: message });
  }

  static async #composeNotification({
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
              Use country flag emojis from the payload when they are available.
              Vary wording, sentence rhythm, and openings between notifications so the message does not read like a fixed template.
              Keep it natural, direct, and concise. Use markdown only when helpful.
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
      return this.#createFallbackNotification(event);
    }
  }

  static #createFallbackNotification(event: WorldCupDetectedEvent) {
    const { payload } = event;
    const homeTeam = this.#renderPayloadTeam(payload.homeTeam);
    const awayTeam = this.#renderPayloadTeam(payload.awayTeam);

    if (payload.eventType === 'kickoff-reminder') {
      return `${homeTeam} vs ${awayTeam} kicks off in ${payload.minutesUntilKickoff ?? 15} minutes.`;
    }

    if (payload.eventType === 'kickoff') {
      return `Kickoff: ${homeTeam} vs ${awayTeam} has started.`;
    }

    if (payload.eventType === 'goal' && payload.scoringTeam) {
      const scoringTeam = this.#renderPayloadTeam(payload.scoringTeam);
      const scorer = payload.scoringTeam.scorerName
        ? ` ${payload.scoringTeam.scorerName}${payload.scoringTeam.goalMinute ? ` ${payload.scoringTeam.goalMinute}'` : ''}.`
        : '';

      return `Goal for ${scoringTeam}.${scorer} ${payload.matchLabel}.`;
    }

    return `Full time: ${payload.matchLabel}.`;
  }

  static #renderPayloadTeam(team: { flagEmoji?: string; name: string }) {
    return [team.flagEmoji, team.name].filter(Boolean).join(' ');
  }
}

import type {
  WorldCupDetectedEvent,
  WorldCupEventPayload,
  WorldCupGameSnapshot,
} from '@/app/world-cup/types';

import { WorldCupGameStatusSchema } from '@/app/world-cup/schemas';
import { WorldCupTeamRegistry } from '@/app/world-cup/teams';
import { WorldCupTimeService } from '@/app/world-cup/tracking/time';

export class WorldCupEventDetector {
  private static kickoffReminderMinutes = 15;

  static detect({
    previous,
    current,
    now = new Date(),
  }: {
    previous: WorldCupGameSnapshot | null;
    current: WorldCupGameSnapshot;
    now?: Date;
  }): WorldCupDetectedEvent[] {
    const events: WorldCupDetectedEvent[] = [];

    if (this.shouldSendKickoffReminder({ current, now })) {
      const minutesUntilKickoff = this.getMinutesUntilKickoff({ current, now });

      events.push({
        eventKey: `world-cup-2026:kickoff-reminder:${current.gameId}`,
        eventType: 'kickoff-reminder',
        gameId: current.gameId,
        teamIds: this.getParticipantTeamIds(current),
        payload: this.createPayload(current, 'kickoff-reminder', undefined, {
          minutesUntilKickoff: minutesUntilKickoff ?? undefined,
        }),
      });
    }

    if (previous && this.isGameNotStarted(previous) && this.isGameActive(current)) {
      events.push({
        eventKey: `world-cup-2026:kickoff:${current.gameId}`,
        eventType: 'kickoff',
        gameId: current.gameId,
        teamIds: this.getParticipantTeamIds(current),
        payload: this.createPayload(current, 'kickoff'),
      });
    }

    if (previous) {
      events.push(
        ...this.detectGoals({
          previousScore: previous.homeScore,
          currentScore: current.homeScore,
          current,
          side: 'home',
        }),
        ...this.detectGoals({
          previousScore: previous.awayScore,
          currentScore: current.awayScore,
          current,
          side: 'away',
        }),
      );
    }

    if (previous && !previous.finished && current.finished) {
      events.push({
        eventKey: `world-cup-2026:game-end:${current.gameId}`,
        eventType: 'game-end',
        gameId: current.gameId,
        teamIds: this.getParticipantTeamIds(current),
        payload: this.createPayload(current, 'game-end'),
      });
    }

    return events;
  }

  private static detectGoals({
    previousScore,
    currentScore,
    current,
    side,
  }: {
    previousScore: number;
    currentScore: number;
    current: WorldCupGameSnapshot;
    side: 'home' | 'away';
  }): WorldCupDetectedEvent[] {
    if (currentScore <= previousScore) {
      return [];
    }

    const scoringTeam =
      side === 'home'
        ? {
            id: current.homeTeamId,
            name: current.homeTeamName,
            scorers: current.homeScorers,
          }
        : {
            id: current.awayTeamId,
            name: current.awayTeamName,
            scorers: current.awayScorers,
          };

    return Array.from({ length: currentScore - previousScore }, (_, index) => {
      const scoreAfterGoal = previousScore + index + 1;
      const goalScorer = this.parseGoalScorer(scoringTeam.scorers, scoreAfterGoal);

      return {
        eventKey: `world-cup-2026:goal:${current.gameId}:${scoringTeam.id}:${scoreAfterGoal}`,
        eventType: 'goal',
        gameId: current.gameId,
        teamIds: [scoringTeam.id],
        payload: this.createPayload(current, 'goal', {
          id: scoringTeam.id,
          name: scoringTeam.name,
          fifaCode: this.getTeamFifaCode(scoringTeam.id),
          flagEmoji: this.getTeamFlagEmoji(scoringTeam.id),
          scorers: scoringTeam.scorers,
          scoreAfterGoal,
          goalsDetected: currentScore - previousScore,
          scorerName: goalScorer?.name,
          goalMinute: goalScorer?.minute,
        }),
      };
    });
  }

  private static createPayload(
    game: WorldCupGameSnapshot,
    eventType: WorldCupEventPayload['eventType'],
    scoringTeam?: WorldCupEventPayload['scoringTeam'],
    options: { minutesUntilKickoff?: number } = {},
  ): WorldCupEventPayload {
    return {
      eventType,
      gameId: game.gameId,
      matchLabel: `${game.homeTeamName} ${game.homeScore}-${game.awayScore} ${game.awayTeamName}`,
      homeTeam: this.createPayloadTeam({
        id: game.homeTeamId,
        name: game.homeTeamName,
        score: game.homeScore,
        scorers: game.homeScorers,
      }),
      awayTeam: this.createPayloadTeam({
        id: game.awayTeamId,
        name: game.awayTeamName,
        score: game.awayScore,
        scorers: game.awayScorers,
      }),
      localDate: game.localDate,
      timeElapsed: game.timeElapsed,
      minutesUntilKickoff: options.minutesUntilKickoff,
      scoringTeam,
    };
  }

  private static createPayloadTeam({
    id,
    name,
    score,
    scorers,
  }: {
    id: string;
    name: string;
    score: number;
    scorers: string;
  }) {
    return {
      id,
      name,
      fifaCode: this.getTeamFifaCode(id),
      flagEmoji: this.getTeamFlagEmoji(id),
      score,
      scorers,
    };
  }

  private static getTeamFifaCode(teamId: string) {
    return WorldCupTeamRegistry.getById(teamId)?.fifaCode;
  }

  private static getTeamFlagEmoji(teamId: string) {
    return WorldCupTeamRegistry.getFlagEmojiById(teamId);
  }

  private static getParticipantTeamIds(game: WorldCupGameSnapshot) {
    return [game.homeTeamId, game.awayTeamId].filter((teamId) => teamId !== '0');
  }

  private static isGameNotStarted(game: Pick<WorldCupGameSnapshot, 'timeElapsed' | 'finished'>) {
    return !game.finished && this.normalizeStatus(game.timeElapsed) === 'notstarted';
  }

  private static isGameActive(game: Pick<WorldCupGameSnapshot, 'timeElapsed' | 'finished'>) {
    return !game.finished && !this.isGameNotStarted(game);
  }

  private static normalizeStatus(value: string) {
    return WorldCupGameStatusSchema.parse(value);
  }

  private static shouldSendKickoffReminder({
    current,
    now,
  }: {
    current: WorldCupGameSnapshot;
    now: Date;
  }) {
    if (!this.isGameNotStarted(current)) {
      return false;
    }

    const minutesUntilKickoff = this.getMinutesUntilKickoff({ current, now });

    return (
      minutesUntilKickoff !== null &&
      minutesUntilKickoff >= 0 &&
      minutesUntilKickoff <= this.kickoffReminderMinutes
    );
  }

  private static getMinutesUntilKickoff({
    current,
    now,
  }: {
    current: WorldCupGameSnapshot;
    now: Date;
  }) {
    const kickoffAt = WorldCupTimeService.getKickoffAt(current);

    if (!kickoffAt) {
      return null;
    }

    return Math.ceil((kickoffAt.getTime() - now.getTime()) / 60_000);
  }

  private static parseGoalScorer(scorers: string, scoreAfterGoal: number) {
    const entries = this.parseScorerEntries(scorers);
    const entry = entries[scoreAfterGoal - 1];

    if (!entry) {
      return null;
    }

    const trailingMinuteMatch = /^(?<name>.+?)\s+(?<minute>\d{1,3}(?:\+\d{1,2})?)['’]?$/.exec(
      entry,
    );

    if (trailingMinuteMatch?.groups?.name && trailingMinuteMatch.groups.minute) {
      return {
        name: trailingMinuteMatch.groups.name.trim(),
        minute: trailingMinuteMatch.groups.minute,
      };
    }

    const leadingMinuteMatch = /^(?<minute>\d{1,3}(?:\+\d{1,2})?)['’]?\s+(?<name>.+)$/.exec(entry);

    if (leadingMinuteMatch?.groups?.name && leadingMinuteMatch.groups.minute) {
      return {
        name: leadingMinuteMatch.groups.name.trim(),
        minute: leadingMinuteMatch.groups.minute,
      };
    }

    return { name: entry, minute: undefined };
  }

  private static parseScorerEntries(value: string) {
    const trimmed = value.trim();

    if (!trimmed || trimmed.toLowerCase() === 'null') {
      return [];
    }

    const quotedEntries = [...trimmed.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]?.trim())
      .filter((entry): entry is string => Boolean(entry));

    if (quotedEntries.length > 0) {
      return quotedEntries;
    }

    return trimmed
      .replace(/^[{[]/, '')
      .replace(/[}\]]$/, '')
      .split(/[;,]/)
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
}

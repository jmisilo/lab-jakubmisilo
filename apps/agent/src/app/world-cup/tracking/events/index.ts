import type {
  WorldCupDetectedEvent,
  WorldCupEventPayload,
  WorldCupGameSnapshot,
} from '@/app/world-cup/types';

import { WorldCupGameStatusSchema } from '@/app/world-cup/schemas';

const KICKOFF_REMINDER_MINUTES = 15;
const WORLD_CUP_USER_TIME_ZONE = 'Europe/Warsaw';

export class WorldCupEventDetector {
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
        eventType: 'kickoff_reminder',
        gameId: current.gameId,
        teamIds: this.getParticipantTeamIds(current),
        payload: this.createPayload(current, 'kickoff_reminder', undefined, {
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
        eventType: 'game_end',
        gameId: current.gameId,
        teamIds: this.getParticipantTeamIds(current),
        payload: this.createPayload(current, 'game_end'),
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
      homeTeam: {
        id: game.homeTeamId,
        name: game.homeTeamName,
        score: game.homeScore,
        scorers: game.homeScorers,
      },
      awayTeam: {
        id: game.awayTeamId,
        name: game.awayTeamName,
        score: game.awayScore,
        scorers: game.awayScorers,
      },
      localDate: game.localDate,
      timeElapsed: game.timeElapsed,
      minutesUntilKickoff: options.minutesUntilKickoff,
      scoringTeam,
    };
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
      minutesUntilKickoff <= KICKOFF_REMINDER_MINUTES
    );
  }

  private static getMinutesUntilKickoff({
    current,
    now,
  }: {
    current: WorldCupGameSnapshot;
    now: Date;
  }) {
    const kickoffAt = this.parseApiLocalDate(current.localDate);

    if (!kickoffAt) {
      return null;
    }

    return Math.ceil((kickoffAt.getTime() - now.getTime()) / 60_000);
  }

  private static parseApiLocalDate(value: string) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(value.trim());

    if (!match) {
      return null;
    }

    const [, month, day, year, hour, minute] = match;

    if (!month || !day || !year || !hour || !minute) {
      return null;
    }

    return this.zonedTimeToDate({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      timeZone: WORLD_CUP_USER_TIME_ZONE,
    });
  }

  private static zonedTimeToDate({
    year,
    month,
    day,
    hour,
    minute,
    timeZone,
  }: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    timeZone: string;
  }) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    const firstOffset = this.getTimeZoneOffsetMs(timeZone, utcGuess);
    const firstPass = new Date(utcGuess.getTime() - firstOffset);
    const correctedOffset = this.getTimeZoneOffsetMs(timeZone, firstPass);

    return new Date(utcGuess.getTime() - correctedOffset);
  }

  private static getTimeZoneOffsetMs(timeZone: string, date: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return (
      Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
      ) - date.getTime()
    );
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

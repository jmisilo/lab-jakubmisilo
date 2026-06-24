import type { WorldCupTeamFifaCode } from '@/app/world-cup/teams';
import type { WorldCupGameSnapshot } from '@/app/world-cup/types';

import { WORLD_CUP_TEAMS, WorldCupTeamRegistry } from '@/app/world-cup/teams';
import { WorldCupApiClient } from '@/app/world-cup/tracking/api';
import { WorldCupTimeService } from '@/app/world-cup/tracking/time';

type WorldCupContextFocus = 'all' | 'schedule' | 'team' | 'tables' | 'knockout' | 'stage';

type WorldCupContextGame = {
  gameId: string;
  stage: string;
  group: string;
  matchday: string;
  status: 'scheduled' | 'active' | 'finished';
  kickoffAt: Date | null;
  kickoffDate: string | null;
  kickoffTime: string;
  homeTeam: WorldCupContextTeam;
  awayTeam: WorldCupContextTeam;
  score: string;
  winnerTeamId?: string;
};

type WorldCupContextTeam = {
  id: string;
  name: string;
  fifaCode?: string;
  flagEmoji?: string;
  score: number;
};

type WorldCupGroupTableRow = {
  team: WorldCupContextTeam;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

type WorldCupContextInput = {
  games: WorldCupGameSnapshot[];
  timeZone: string;
  now?: Date;
  focus?: WorldCupContextFocus;
  teamCodes?: WorldCupTeamFifaCode[];
  date?: string;
};

export type WorldCupContext = {
  timeZone: string;
  generatedAt: string;
  today: string;
  currentStage: string;
  summaryMarkdown: string;
  scheduleMarkdown: string;
  groupTablesMarkdown: string;
  knockoutLadderMarkdown: string;
  games: WorldCupContextGame[];
};

export class WorldCupContextService {
  static async getContext({
    timeZone,
    now = new Date(),
    focus = 'all',
    teamCodes,
    date,
  }: Omit<WorldCupContextInput, 'games'>): Promise<WorldCupContext> {
    return this.createContext({
      games: await WorldCupApiClient.getGames(),
      timeZone,
      now,
      focus,
      teamCodes,
      date,
    });
  }

  static createContext({
    games,
    timeZone,
    now = new Date(),
    focus = 'all',
    teamCodes,
    date,
  }: WorldCupContextInput): WorldCupContext {
    const safeTimeZone = WorldCupTimeService.resolveTimeZone(timeZone);
    const contextGames = games
      .map((game) => this.createContextGame({ game, timeZone: safeTimeZone }))
      .sort((gameA, gameB) => this.compareGames(gameA, gameB));
    const requestedTeamIds = this.getRequestedTeamIds(teamCodes);
    const requestedDate = date ?? WorldCupTimeService.formatDateKey(now, safeTimeZone);
    const focusedGames = this.filterGames({
      games: contextGames,
      focus,
      requestedTeamIds,
      requestedDate,
    });
    const groupTables = this.createGroupTables(contextGames);
    const currentStage = this.getCurrentStage(contextGames, now);

    return {
      timeZone: safeTimeZone,
      generatedAt: WorldCupTimeService.formatDateTime(now, safeTimeZone),
      today: requestedDate,
      currentStage,
      summaryMarkdown: this.renderSummary({
        games: contextGames,
        currentStage,
        requestedDate,
        timeZone: safeTimeZone,
      }),
      scheduleMarkdown: this.renderSchedule(focusedGames),
      groupTablesMarkdown: this.renderGroupTables(groupTables),
      knockoutLadderMarkdown: this.renderKnockoutLadder(contextGames),
      games: focusedGames,
    };
  }

  private static createContextGame({
    game,
    timeZone,
  }: {
    game: WorldCupGameSnapshot;
    timeZone: string;
  }): WorldCupContextGame {
    const kickoffAt = WorldCupTimeService.getKickoffAt(game);
    const homeTeam = this.createContextTeam({
      id: game.homeTeamId,
      name: game.homeTeamName,
      score: game.homeScore,
    });
    const awayTeam = this.createContextTeam({
      id: game.awayTeamId,
      name: game.awayTeamName,
      score: game.awayScore,
    });

    return {
      gameId: game.gameId,
      stage: this.normalizeStage(String(game.raw.type ?? '')),
      group: String(game.raw.group ?? ''),
      matchday: String(game.raw.matchday ?? ''),
      status: this.getGameStatus(game),
      kickoffAt,
      kickoffDate: kickoffAt ? WorldCupTimeService.formatDateKey(kickoffAt, timeZone) : null,
      kickoffTime: kickoffAt
        ? WorldCupTimeService.formatDateTime(kickoffAt, timeZone)
        : game.localDate,
      homeTeam,
      awayTeam,
      score: `${game.homeScore}-${game.awayScore}`,
      winnerTeamId: this.getWinnerTeamId({ game, homeTeam, awayTeam }),
    };
  }

  private static createContextTeam({
    id,
    name,
    score,
  }: {
    id: string;
    name: string;
    score: number;
  }): WorldCupContextTeam {
    const team = WorldCupTeamRegistry.getById(id);

    return {
      id,
      name,
      fifaCode: team?.fifaCode,
      flagEmoji: WorldCupTeamRegistry.getFlagEmojiById(id),
      score,
    };
  }

  private static getGameStatus(game: WorldCupGameSnapshot): WorldCupContextGame['status'] {
    if (game.finished) {
      return 'finished';
    }

    if (game.timeElapsed.trim().toLowerCase() === 'notstarted') {
      return 'scheduled';
    }

    return 'active';
  }

  private static getWinnerTeamId({
    game,
    homeTeam,
    awayTeam,
  }: {
    game: WorldCupGameSnapshot;
    homeTeam: WorldCupContextTeam;
    awayTeam: WorldCupContextTeam;
  }) {
    if (!game.finished || game.homeScore === game.awayScore) {
      return undefined;
    }

    return game.homeScore > game.awayScore ? homeTeam.id : awayTeam.id;
  }

  private static createGroupTables(games: WorldCupContextGame[]) {
    const tables = new Map<string, WorldCupGroupTableRow[]>();

    for (const team of WORLD_CUP_TEAMS) {
      const table = tables.get(team.group) ?? [];
      table.push({
        team: this.createContextTeam({ id: team.id, name: team.name, score: 0 }),
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      });
      tables.set(team.group, table);
    }

    for (const game of games) {
      if (game.status !== 'finished' || !this.isGroupStage(game) || !game.group) {
        continue;
      }

      const table = tables.get(game.group);

      if (!table) {
        continue;
      }

      const homeRow = table.find((row) => row.team.id === game.homeTeam.id);
      const awayRow = table.find((row) => row.team.id === game.awayTeam.id);

      if (!homeRow || !awayRow) {
        continue;
      }

      this.applyResult({
        row: homeRow,
        goalsFor: game.homeTeam.score,
        goalsAgainst: game.awayTeam.score,
      });
      this.applyResult({
        row: awayRow,
        goalsFor: game.awayTeam.score,
        goalsAgainst: game.homeTeam.score,
      });
    }

    return new Map(
      [...tables.entries()].map(([group, rows]) => [
        group,
        rows.sort((rowA, rowB) => this.compareTableRows(rowA, rowB)),
      ]),
    );
  }

  private static applyResult({
    row,
    goalsFor,
    goalsAgainst,
  }: {
    row: WorldCupGroupTableRow;
    goalsFor: number;
    goalsAgainst: number;
  }) {
    row.played += 1;
    row.goalsFor += goalsFor;
    row.goalsAgainst += goalsAgainst;
    row.goalDifference = row.goalsFor - row.goalsAgainst;

    if (goalsFor > goalsAgainst) {
      row.won += 1;
      row.points += 3;
      return;
    }

    if (goalsFor < goalsAgainst) {
      row.lost += 1;
      return;
    }

    row.drawn += 1;
    row.points += 1;
  }

  private static renderSummary({
    games,
    currentStage,
    requestedDate,
    timeZone,
  }: {
    games: WorldCupContextGame[];
    currentStage: string;
    requestedDate: string;
    timeZone: string;
  }) {
    const todayGames = games.filter((game) => game.kickoffDate === requestedDate);
    const activeGames = games.filter((game) => game.status === 'active');
    const finishedGames = games.filter((game) => game.status === 'finished');
    const scheduledGames = games.filter((game) => game.status === 'scheduled');

    return [
      `World Cup context generated for ${timeZone}.`,
      `Current stage: ${currentStage}.`,
      `Today (${requestedDate}): ${todayGames.length} game(s).`,
      `Finished: ${finishedGames.length}. Live: ${activeGames.length}. Scheduled: ${scheduledGames.length}.`,
    ].join('\n');
  }

  private static renderSchedule(games: WorldCupContextGame[]) {
    if (games.length === 0) {
      return 'No games match the requested World Cup context.';
    }

    return games
      .map((game) => {
        const home = this.renderTeam(game.homeTeam);
        const away = this.renderTeam(game.awayTeam);
        const status =
          game.status === 'finished'
            ? `FT ${game.score}`
            : game.status === 'active'
              ? `LIVE ${game.score}`
              : game.kickoffTime;

        return `- ${status} | ${this.renderGameStage(game)} | ${home} vs ${away}`;
      })
      .join('\n');
  }

  private static renderGroupTables(tables: Map<string, WorldCupGroupTableRow[]>) {
    return [...tables.entries()]
      .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
      .map(([group, rows]) =>
        [
          `Group ${group}`,
          '| Team | P | W | D | L | GF | GA | GD | Pts |',
          '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
          ...rows.map(
            (row) =>
              `| ${this.renderTeam(row.team)} | ${row.played} | ${row.won} | ${row.drawn} | ${row.lost} | ${row.goalsFor} | ${row.goalsAgainst} | ${row.goalDifference} | ${row.points} |`,
          ),
        ].join('\n'),
      )
      .join('\n\n');
  }

  private static renderKnockoutLadder(games: WorldCupContextGame[]) {
    const knockoutGames = games.filter((game) => !this.isGroupStage(game));

    if (knockoutGames.length === 0) {
      return 'Knockout ladder is not available yet.';
    }

    const gamesByStage = new Map<string, WorldCupContextGame[]>();

    for (const game of knockoutGames) {
      const stageGames = gamesByStage.get(game.stage) ?? [];
      stageGames.push(game);
      gamesByStage.set(game.stage, stageGames);
    }

    return [...gamesByStage.entries()]
      .sort(([stageA], [stageB]) => this.getStageRank(stageA) - this.getStageRank(stageB))
      .map(([stage, stageGames]) =>
        [
          stage,
          ...stageGames
            .sort((gameA, gameB) => this.compareGames(gameA, gameB))
            .map((game) => {
              const winner = game.winnerTeamId
                ? ` -> winner ${this.renderTeam(
                    game.winnerTeamId === game.homeTeam.id ? game.homeTeam : game.awayTeam,
                  )}`
                : '';
              const status =
                game.status === 'finished'
                  ? `FT ${game.score}`
                  : game.status === 'active'
                    ? `LIVE ${game.score}`
                    : game.kickoffTime;

              return `- ${status} | ${this.renderTeam(game.homeTeam)} vs ${this.renderTeam(game.awayTeam)}${winner}`;
            }),
        ].join('\n'),
      )
      .join('\n\n');
  }

  private static filterGames({
    games,
    focus,
    requestedTeamIds,
    requestedDate,
  }: {
    games: WorldCupContextGame[];
    focus: WorldCupContextFocus;
    requestedTeamIds: Set<string>;
    requestedDate: string;
  }) {
    const relevantGames = games.filter((game) => {
      if (requestedTeamIds.size > 0) {
        return requestedTeamIds.has(game.homeTeam.id) || requestedTeamIds.has(game.awayTeam.id);
      }

      if (focus === 'schedule') {
        return game.kickoffDate === requestedDate;
      }

      return true;
    });

    if (focus === 'team') {
      return relevantGames;
    }

    if (focus === 'knockout') {
      return relevantGames.filter((game) => !this.isGroupStage(game));
    }

    return relevantGames;
  }

  private static getRequestedTeamIds(teamCodes?: WorldCupTeamFifaCode[]): Set<string> {
    return new Set(
      (teamCodes ?? [])
        .map((teamCode): string | undefined => WorldCupTeamRegistry.getByFifaCode(teamCode)?.id)
        .filter((teamId): teamId is string => Boolean(teamId)),
    );
  }

  private static getCurrentStage(games: WorldCupContextGame[], now: Date) {
    const activeGame = games.find((game) => game.status === 'active');

    if (activeGame) {
      return `${activeGame.stage} live`;
    }

    const nextGame = games.find(
      (game) => game.kickoffAt && game.status === 'scheduled' && game.kickoffAt >= now,
    );

    if (nextGame) {
      return nextGame.stage;
    }

    const lastFinishedGame = [...games]
      .reverse()
      .find((game) => game.status === 'finished' && game.kickoffAt);

    return lastFinishedGame ? `${lastFinishedGame.stage} completed` : 'Not started';
  }

  private static renderTeam(team: WorldCupContextTeam) {
    return [team.flagEmoji, team.name, team.fifaCode ? `(${team.fifaCode})` : undefined]
      .filter(Boolean)
      .join(' ');
  }

  private static renderGameStage(game: WorldCupContextGame) {
    if (this.isGroupStage(game) && game.group) {
      return `Group ${game.group}`;
    }

    return game.stage;
  }

  private static isGroupStage(game: WorldCupContextGame) {
    return game.stage.toLowerCase().includes('group');
  }

  private static normalizeStage(value: string) {
    const normalized = value.trim();

    if (!normalized) {
      return 'Unknown stage';
    }

    return normalized
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  private static compareGames(gameA: WorldCupContextGame, gameB: WorldCupContextGame) {
    if (!gameA.kickoffAt && !gameB.kickoffAt) {
      return Number(gameA.gameId) - Number(gameB.gameId);
    }

    if (!gameA.kickoffAt) {
      return 1;
    }

    if (!gameB.kickoffAt) {
      return -1;
    }

    return gameA.kickoffAt.getTime() - gameB.kickoffAt.getTime();
  }

  private static compareTableRows(rowA: WorldCupGroupTableRow, rowB: WorldCupGroupTableRow) {
    return (
      rowB.points - rowA.points ||
      rowB.goalDifference - rowA.goalDifference ||
      rowB.goalsFor - rowA.goalsFor ||
      rowA.team.name.localeCompare(rowB.team.name)
    );
  }

  private static getStageRank(stage: string) {
    const normalized = stage.toLowerCase();

    if (normalized.includes('round') || normalized.includes('16')) {
      return 1;
    }

    if (normalized.includes('quarter')) {
      return 2;
    }

    if (normalized.includes('semi')) {
      return 3;
    }

    if (normalized.includes('third')) {
      return 4;
    }

    if (normalized.includes('final')) {
      return 5;
    }

    return 99;
  }
}

import type { WorldCupGameSnapshot } from '@/archive/world-cup/app/types';

import { WorldCupContextService } from '.';

const createSnapshot = (overrides: Partial<WorldCupGameSnapshot> = {}): WorldCupGameSnapshot => ({
  gameId: '1',
  homeTeamId: '41',
  awayTeamId: '43',
  homeTeamName: 'Portugal',
  awayTeamName: 'Uzbekistan',
  homeScore: 2,
  awayScore: 1,
  homeScorers: 'null',
  awayScorers: 'null',
  finished: true,
  timeElapsed: 'finished',
  localDate: '06/17/2026 19:00',
  raw: {
    _id: 'game-1',
    id: '1',
    home_team_id: '41',
    away_team_id: '43',
    home_score: '2',
    away_score: '1',
    home_scorers: 'null',
    away_scorers: 'null',
    group: 'K',
    matchday: '1',
    local_date: '06/17/2026 19:00',
    stadium_id: '1',
    finished: 'TRUE',
    time_elapsed: 'finished',
    type: 'group',
  },
  ...overrides,
});

describe('WorldCupContextService', () => {
  it('builds group tables from finished games only', () => {
    const context = WorldCupContextService.createContext({
      timeZone: 'Europe/Warsaw',
      now: new Date(Date.UTC(2026, 5, 18, 10, 0)),
      games: [
        createSnapshot(),
        createSnapshot({
          gameId: '2',
          homeTeamId: '42',
          awayTeamId: '44',
          homeTeamName: 'Democratic Republic of the Congo',
          awayTeamName: 'Colombia',
          homeScore: 3,
          awayScore: 3,
          finished: false,
          timeElapsed: 'notstarted',
          raw: {
            ...createSnapshot().raw,
            _id: 'game-2',
            id: '2',
            home_team_id: '42',
            away_team_id: '44',
            home_score: '3',
            away_score: '3',
            finished: 'FALSE',
            time_elapsed: 'notstarted',
          },
        }),
      ],
    });

    expect(context.groupTablesMarkdown).toContain(
      '| 🇵🇹 Portugal (POR) | 1 | 1 | 0 | 0 | 2 | 1 | 1 | 3 |',
    );
    expect(context.groupTablesMarkdown).toContain(
      '| 🇺🇿 Uzbekistan (UZB) | 1 | 0 | 0 | 1 | 1 | 2 | -1 | 0 |',
    );
    expect(context.groupTablesMarkdown).toContain(
      '| 🇨🇩 Democratic Republic of the Congo (COD) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
    );
  });

  it('formats venue-local schedule in the requested user timezone', () => {
    const context = WorldCupContextService.createContext({
      timeZone: 'Europe/Warsaw',
      now: new Date(Date.UTC(2026, 5, 24, 10, 0)),
      focus: 'team',
      teamCodes: ['BIH'],
      games: [
        createSnapshot({
          gameId: '55',
          homeTeamId: '6',
          awayTeamId: '7',
          homeTeamName: 'Bosnia and Herzegovina',
          awayTeamName: 'Qatar',
          homeScore: 0,
          awayScore: 0,
          finished: false,
          timeElapsed: 'notstarted',
          localDate: '06/24/2026 12:00',
          raw: {
            ...createSnapshot().raw,
            _id: 'game-55',
            id: '55',
            home_team_id: '6',
            away_team_id: '7',
            home_score: '0',
            away_score: '0',
            group: 'B',
            matchday: '3',
            local_date: '06/24/2026 12:00',
            stadium_id: '16',
            finished: 'FALSE',
            time_elapsed: 'notstarted',
          },
        }),
      ],
    });

    expect(context.scheduleMarkdown).toContain('24 Jun 2026, 21:00');
    expect(context.scheduleMarkdown).toContain('| Group B |');
    expect(context.scheduleMarkdown).toContain('🇧🇦 Bosnia and Herzegovina (BIH) vs 🇶🇦 Qatar (QAT)');
  });

  it('renders knockout games as a stage ladder', () => {
    const context = WorldCupContextService.createContext({
      timeZone: 'Europe/Warsaw',
      now: new Date(Date.UTC(2026, 6, 1, 10, 0)),
      focus: 'knockout',
      games: [
        createSnapshot({
          gameId: '50',
          homeTeamName: 'Portugal',
          awayTeamName: 'Spain',
          awayTeamId: '29',
          homeScore: 0,
          awayScore: 0,
          finished: false,
          timeElapsed: 'notstarted',
          localDate: '07/05/2026 21:00',
          raw: {
            ...createSnapshot().raw,
            _id: 'game-50',
            id: '50',
            away_team_id: '29',
            home_score: '0',
            away_score: '0',
            group: '',
            local_date: '07/05/2026 21:00',
            finished: 'FALSE',
            time_elapsed: 'notstarted',
            type: 'round_of_16',
          },
        }),
      ],
    });

    expect(context.knockoutLadderMarkdown).toContain('Round Of 16');
    expect(context.knockoutLadderMarkdown).toContain('🇵🇹 Portugal (POR) vs 🇪🇸 Spain (ESP)');
  });
});

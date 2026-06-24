import type { WorldCupGameSnapshot } from '@/app/world-cup/types';

import { WorldCupTimeService } from '.';

const createSnapshot = (overrides: Partial<WorldCupGameSnapshot> = {}): WorldCupGameSnapshot => ({
  gameId: '55',
  homeTeamId: '6',
  awayTeamId: '7',
  homeTeamName: 'Bosnia and Herzegovina',
  awayTeamName: 'Qatar',
  homeScore: 0,
  awayScore: 0,
  homeScorers: 'null',
  awayScorers: 'null',
  finished: false,
  timeElapsed: 'notstarted',
  localDate: '06/24/2026 12:00',
  raw: {
    _id: 'game-55',
    id: '55',
    home_team_id: '6',
    away_team_id: '7',
    home_score: '0',
    away_score: '0',
    home_scorers: 'null',
    away_scorers: 'null',
    group: 'B',
    matchday: '3',
    local_date: '06/24/2026 12:00',
    stadium_id: '16',
    finished: 'FALSE',
    time_elapsed: 'notstarted',
    type: 'group',
  },
  ...overrides,
});

describe('WorldCupTimeService', () => {
  it('converts API venue-local kickoff time to Warsaw time', () => {
    const kickoffAt = WorldCupTimeService.getKickoffAt(createSnapshot());

    expect(kickoffAt?.toISOString()).toBe('2026-06-24T19:00:00.000Z');
    expect(WorldCupTimeService.formatDateTime(kickoffAt!, 'Europe/Warsaw')).toBe(
      '24 Jun 2026, 21:00',
    );
  });
});

import type { WorldCupGameSnapshot } from '@/app/features/world-cup/types';

import { WorldCupEventDetector } from '.';

const createSnapshot = (overrides: Partial<WorldCupGameSnapshot> = {}): WorldCupGameSnapshot => ({
  gameId: '21',
  homeTeamId: '41',
  awayTeamId: '42',
  homeTeamName: 'Portugal',
  awayTeamName: 'Democratic Republic of the Congo',
  homeScore: 0,
  awayScore: 0,
  homeScorers: 'null',
  awayScorers: 'null',
  finished: false,
  timeElapsed: 'notstarted',
  localDate: '06/17/2026 12:00',
  raw: {
    _id: 'game-21',
    id: '21',
    home_team_id: '41',
    away_team_id: '42',
    home_score: '0',
    away_score: '0',
    home_scorers: 'null',
    away_scorers: 'null',
    group: 'K',
    matchday: '1',
    local_date: '06/17/2026 12:00',
    stadium_id: '5',
    finished: 'FALSE',
    time_elapsed: 'notstarted',
    type: 'group',
  },
  ...overrides,
});

describe('WorldCupEventDetector.detect', () => {
  it('detects kickoff reminder in the 15 minute pre-kickoff window', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot(),
      current: createSnapshot(),
      now: new Date(Date.UTC(2026, 5, 17, 16, 45)),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:kickoff-reminder:21',
        eventType: 'kickoff-reminder',
        teamIds: ['41', '42'],
        payload: expect.objectContaining({
          eventType: 'kickoff-reminder',
          minutesUntilKickoff: 15,
        }),
      }),
    ]);
  });

  it('detects kickoff reminder even when the previous snapshot is missing', () => {
    const events = WorldCupEventDetector.detect({
      previous: null,
      current: createSnapshot(),
      now: new Date(Date.UTC(2026, 5, 17, 16, 50)),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:kickoff-reminder:21',
        eventType: 'kickoff-reminder',
        payload: expect.objectContaining({
          minutesUntilKickoff: 10,
        }),
      }),
    ]);
  });

  it('interprets kickoff reminder times from the match venue timezone', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot(),
      current: createSnapshot({
        localDate: '06/24/2026 12:00',
        raw: {
          ...createSnapshot().raw,
          local_date: '06/24/2026 12:00',
          stadium_id: '16',
        },
      }),
      now: new Date(Date.UTC(2026, 5, 24, 18, 45)),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:kickoff-reminder:21',
        eventType: 'kickoff-reminder',
        payload: expect.objectContaining({
          minutesUntilKickoff: 15,
        }),
      }),
    ]);
  });

  it('does not detect kickoff reminder before the pre-kickoff window', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot(),
      current: createSnapshot(),
      now: new Date(Date.UTC(2026, 5, 17, 16, 44)),
    });

    expect(events).toEqual([]);
  });

  it('detects kickoff when a game leaves notstarted state', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot(),
      current: createSnapshot({ timeElapsed: '1' }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:kickoff:21',
        eventType: 'kickoff',
        teamIds: ['41', '42'],
      }),
    ]);
  });

  it('detects goal score deltas with a stable per-score event key', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot({ homeScore: 0, timeElapsed: '12' }),
      current: createSnapshot({
        homeScore: 1,
        timeElapsed: '13',
        homeScorers: '{"J. Neves 13\'"}',
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:goal:21:41:1',
        eventType: 'goal',
        teamIds: ['41'],
        payload: expect.objectContaining({
          scoringTeam: expect.objectContaining({
            id: '41',
            name: 'Portugal',
            scoreAfterGoal: 1,
            scorerName: 'J. Neves',
            goalMinute: '13',
          }),
        }),
      }),
    ]);
  });

  it('uses the scorer entry matching the score after a multi-goal delta', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot({ homeScore: 1, timeElapsed: '45' }),
      current: createSnapshot({
        homeScore: 3,
        timeElapsed: '47',
        homeScorers: '{"Cristiano Ronaldo 22\'","J. Neves 45+1\'","B. Silva 47\'"}',
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:goal:21:41:2',
        payload: expect.objectContaining({
          scoringTeam: expect.objectContaining({
            scoreAfterGoal: 2,
            scorerName: 'J. Neves',
            goalMinute: '45+1',
          }),
        }),
      }),
      expect.objectContaining({
        eventKey: 'world-cup-2026:goal:21:41:3',
        payload: expect.objectContaining({
          scoringTeam: expect.objectContaining({
            scoreAfterGoal: 3,
            scorerName: 'B. Silva',
            goalMinute: '47',
          }),
        }),
      }),
    ]);
  });

  it('detects game end when a game becomes finished', () => {
    const events = WorldCupEventDetector.detect({
      previous: createSnapshot({ homeScore: 1, awayScore: 1, timeElapsed: '90' }),
      current: createSnapshot({
        homeScore: 1,
        awayScore: 1,
        finished: true,
        timeElapsed: 'finished',
      }),
    });

    expect(events).toEqual([
      expect.objectContaining({
        eventKey: 'world-cup-2026:game-end:21',
        eventType: 'game-end',
        teamIds: ['41', '42'],
      }),
    ]);
  });
});

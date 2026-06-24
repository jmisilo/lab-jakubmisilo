import type { WorldCupDetectedEvent } from '@/app/features/world-cup/types';

import { WorldCupSubscriptionService } from '.';

const createGoalEvent = (): WorldCupDetectedEvent => ({
  eventKey: 'world-cup-2026:goal:1:29:1',
  eventType: 'goal',
  gameId: '1',
  teamIds: ['29'],
  payload: {
    eventType: 'goal',
    gameId: '1',
    matchLabel: 'England 0-1 Spain',
    homeTeam: {
      id: '45',
      name: 'England',
      score: 0,
      scorers: 'null',
    },
    awayTeam: {
      id: '29',
      name: 'Spain',
      score: 1,
      scorers: '{"A. Putellas 12\'"}',
    },
    localDate: '06/27/2026 19:00',
    timeElapsed: '12',
    scoringTeam: {
      id: '29',
      name: 'Spain',
      scoreAfterGoal: 1,
      goalsDetected: 1,
      scorers: '{"A. Putellas 12\'"}',
      scorerName: 'A. Putellas',
      goalMinute: '12',
    },
  },
});

describe('WorldCupSubscriptionService.subscriptionMatchesEvent', () => {
  it("matches goals for both sides when a tracked team's match has a goal", () => {
    expect(
      WorldCupSubscriptionService.subscriptionMatchesEvent(
        {
          eventTypes: ['goal'],
          teamId: '45',
        },
        createGoalEvent(),
      ),
    ).toBe(true);
  });

  it('does not match unrelated teams', () => {
    expect(
      WorldCupSubscriptionService.subscriptionMatchesEvent(
        {
          eventTypes: ['goal'],
          teamId: '41',
        },
        createGoalEvent(),
      ),
    ).toBe(false);
  });
});

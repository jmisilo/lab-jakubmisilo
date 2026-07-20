import type { WorldCupDetectedEvent } from '@/archive/world-cup/app/types';
import type { WorldCupSubscription } from '@/archive/world-cup/infrastructure/db';

import { WorldCupDbService } from '@/archive/world-cup/infrastructure/db';

import { WorldCupSubscriptionService } from '.';

jest.mock('@/archive/world-cup/infrastructure/db', () => ({
  WorldCupDbService: {
    getActiveSubscriptionsForThread: jest.fn(),
  },
}));

const dbMock = jest.mocked(WorldCupDbService);

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

const createSubscription = (
  overrides: Partial<WorldCupSubscription> = {},
): WorldCupSubscription => ({
  id: '00000000-0000-0000-0000-000000000001',
  identityId: 'identity-1',
  threadId: 'thread-1',
  scope: 'team',
  teamId: '41',
  teamName: 'Portugal',
  eventTypes: ['kickoff', 'goal', 'game-end'],
  active: true,
  sourceMessageId: null,
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
  ...overrides,
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

describe('WorldCupSubscriptionService.listTrackedSubscriptions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns active tracking details for the current identity and thread', async () => {
    dbMock.getActiveSubscriptionsForThread.mockResolvedValue([createSubscription()]);

    const result = await WorldCupSubscriptionService.listTrackedSubscriptions({
      identityId: 'identity-1',
      threadId: 'thread-1',
    });

    expect(dbMock.getActiveSubscriptionsForThread).toHaveBeenCalledWith({
      identityId: 'identity-1',
      threadId: 'thread-1',
    });
    expect(result.message).toBe('Tracking 1 active World Cup subscription(s) for this chat.');
    expect(result.summaryMarkdown).toContain('Portugal (POR): kickoff, goal, game end');
    expect(result.subscriptions).toEqual([
      expect.objectContaining({
        subscriptionId: '00000000-0000-0000-0000-000000000001',
        teamId: '41',
        teamName: 'Portugal',
        fifaCode: 'POR',
        flagEmoji: '🇵🇹',
        eventTypes: ['kickoff', 'goal', 'game-end'],
      }),
    ]);
  });

  it('returns an empty status when nothing is tracked in the current chat', async () => {
    dbMock.getActiveSubscriptionsForThread.mockResolvedValue([]);

    const result = await WorldCupSubscriptionService.listTrackedSubscriptions({
      identityId: 'identity-1',
      threadId: 'thread-1',
    });

    expect(result).toEqual({
      ok: true,
      subscriptions: [],
      message: 'No active World Cup tracking subscriptions for this chat.',
      summaryMarkdown: 'No active World Cup tracking subscriptions for this chat.',
    });
  });
});

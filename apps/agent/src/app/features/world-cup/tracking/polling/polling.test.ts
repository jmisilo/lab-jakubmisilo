import type { WorldCupDetectedEvent, WorldCupGameSnapshot } from '@/app/features/world-cup/types';

import { WorldCupDbService } from '@/app/features/world-cup/db';
import { WorldCupApiClient } from '@/app/features/world-cup/tracking/api';
import { WorldCupEventDetector } from '@/app/features/world-cup/tracking/events';
import { WorldCupNotificationService } from '@/app/features/world-cup/tracking/notification';
import { WorldCupSubscriptionService } from '@/app/features/world-cup/tracking/subscription';

import { WorldCupPollingService } from '.';

jest.mock('@/app/features/world-cup/db', () => ({
  WorldCupDbService: {
    createDetectedEvent: jest.fn(),
    createPendingDelivery: jest.fn(),
    getGameSnapshot: jest.fn(),
    markDeliveryFailed: jest.fn(),
    markDeliverySent: jest.fn(),
    upsertSnapshot: jest.fn(),
  },
}));

jest.mock('@/app/features/world-cup/tracking/api', () => ({
  WorldCupApiClient: {
    getGames: jest.fn(),
  },
}));

jest.mock('@/app/features/world-cup/tracking/events', () => ({
  WorldCupEventDetector: {
    detect: jest.fn(),
  },
}));

jest.mock('@/app/features/world-cup/tracking/notification', () => ({
  WorldCupNotificationService: {
    postNotification: jest.fn(),
  },
}));

jest.mock('@/app/features/world-cup/tracking/subscription', () => ({
  WorldCupSubscriptionService: {
    findNotificationTargets: jest.fn(),
  },
}));

const dbMock = jest.mocked(WorldCupDbService);
const apiMock = jest.mocked(WorldCupApiClient);
const detectorMock = jest.mocked(WorldCupEventDetector);
const notificationMock = jest.mocked(WorldCupNotificationService);
const subscriptionMock = jest.mocked(WorldCupSubscriptionService);

describe('WorldCupPollingService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    apiMock.getGames.mockResolvedValue([game]);
    dbMock.getGameSnapshot.mockResolvedValue({
      ...previousGame,
      updatedAt: new Date('2026-06-17T18:00:00.000Z'),
    });
    detectorMock.detect.mockReturnValue([event]);
    subscriptionMock.findNotificationTargets.mockResolvedValue([
      {
        identityId: 'identity-1',
        threadId: 'thread-1',
        subscriptionId: '00000000-0000-0000-0000-000000000001',
      },
    ]);
    dbMock.upsertSnapshot.mockResolvedValue();
    dbMock.markDeliverySent.mockResolvedValue();
    dbMock.markDeliveryFailed.mockResolvedValue();
    notificationMock.postNotification.mockResolvedValue();
  });

  it('creates missing deliveries even when the detected event was already recorded', async () => {
    dbMock.createDetectedEvent.mockResolvedValue(null);
    dbMock.createPendingDelivery.mockResolvedValue({
      delivery,
      created: true,
      deliverable: true,
    });

    const result = await WorldCupPollingService.pollAndDeliver({ bot });

    expect(subscriptionMock.findNotificationTargets).toHaveBeenCalledWith(event);
    expect(dbMock.createPendingDelivery).toHaveBeenCalledWith({
      deliveryKey: `${event.eventKey}:thread-1`,
      eventKey: event.eventKey,
      subscriptionId: '00000000-0000-0000-0000-000000000001',
      threadId: 'thread-1',
    });
    expect(notificationMock.postNotification).toHaveBeenCalledWith({
      bot,
      event,
      identityId: 'identity-1',
      threadId: 'thread-1',
    });
    expect(result).toEqual(
      expect.objectContaining({
        eventsCreated: 0,
        deliveriesCreated: 1,
        notificationsSent: 1,
      }),
    );
  });

  it('sends retryable existing deliveries without counting them as newly created', async () => {
    dbMock.createDetectedEvent.mockResolvedValue(null);
    dbMock.createPendingDelivery.mockResolvedValue({
      delivery: { ...delivery, status: 'failed' },
      created: false,
      deliverable: true,
    });

    const result = await WorldCupPollingService.pollAndDeliver({ bot });

    expect(notificationMock.postNotification).toHaveBeenCalledTimes(1);
    expect(dbMock.markDeliverySent).toHaveBeenCalledWith(delivery.id);
    expect(result).toEqual(
      expect.objectContaining({
        deliveriesCreated: 0,
        deliveriesSkipped: 0,
        notificationsSent: 1,
      }),
    );
  });

  it('does not resend completed deliveries', async () => {
    dbMock.createDetectedEvent.mockResolvedValue(null);
    dbMock.createPendingDelivery.mockResolvedValue({
      delivery: { ...delivery, status: 'sent' },
      created: false,
      deliverable: false,
    });

    const result = await WorldCupPollingService.pollAndDeliver({ bot });

    expect(notificationMock.postNotification).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        deliveriesCreated: 0,
        deliveriesSkipped: 1,
        notificationsSent: 0,
      }),
    );
  });
});

const game: WorldCupGameSnapshot = {
  gameId: '1',
  homeTeamId: '41',
  awayTeamId: '43',
  homeTeamName: 'Portugal',
  awayTeamName: 'Uzbekistan',
  homeScore: 1,
  awayScore: 0,
  homeScorers: 'Player 10',
  awayScorers: 'null',
  finished: false,
  timeElapsed: '45',
  localDate: '06/17/2026 19:00',
  raw: {
    _id: 'game-1',
    id: '1',
    home_team_id: '41',
    away_team_id: '43',
    home_score: '1',
    away_score: '0',
    home_scorers: 'Player 10',
    away_scorers: 'null',
    group: 'K',
    matchday: '1',
    local_date: '06/17/2026 19:00',
    persian_date: '',
    stadium_id: '1',
    finished: 'FALSE',
    time_elapsed: '45',
    type: 'group',
  },
};

const previousGame: WorldCupGameSnapshot = {
  ...game,
  homeScore: 0,
  homeScorers: 'null',
  raw: {
    ...game.raw,
    home_score: '0',
    home_scorers: 'null',
  },
};

const event: WorldCupDetectedEvent = {
  eventKey: 'world-cup-2026:goal:1:1-0',
  eventType: 'goal',
  gameId: '1',
  teamIds: ['41', '43'],
  payload: {
    eventType: 'goal',
    gameId: '1',
    matchLabel: 'Portugal vs Uzbekistan',
    homeTeam: {
      id: '41',
      name: 'Portugal',
      fifaCode: 'POR',
      flagEmoji: '🇵🇹',
      score: 1,
      scorers: 'Player 10',
    },
    awayTeam: {
      id: '43',
      name: 'Uzbekistan',
      fifaCode: 'UZB',
      flagEmoji: '🇺🇿',
      score: 0,
      scorers: 'null',
    },
    localDate: '06/17/2026 19:00',
    timeElapsed: '45',
    scoringTeam: {
      id: '41',
      name: 'Portugal',
      fifaCode: 'POR',
      flagEmoji: '🇵🇹',
      scoreAfterGoal: 1,
      goalsDetected: 1,
      scorers: 'Player 10',
      scorerName: 'Player',
      goalMinute: '10',
    },
  },
};

const delivery = {
  id: '00000000-0000-0000-0000-000000000010',
  deliveryKey: `${event.eventKey}:thread-1`,
  eventKey: event.eventKey,
  subscriptionId: '00000000-0000-0000-0000-000000000001',
  threadId: 'thread-1',
  status: 'pending' as const,
  error: null,
  createdAt: new Date('2026-06-17T18:00:00.000Z'),
  deliveredAt: null,
};

const bot = {
  thread: jest.fn(),
  transcripts: {
    list: jest.fn(),
  },
};

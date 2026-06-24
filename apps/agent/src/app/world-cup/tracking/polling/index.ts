import type { WorldCupNotificationBot } from '@/app/world-cup/tracking/notification';

import { randomUUID } from 'node:crypto';

import { WorldCupDbService } from '@/app/world-cup/db';
import { WorldCupApiClient } from '@/app/world-cup/tracking/api';
import { WorldCupEventDetector } from '@/app/world-cup/tracking/events';
import { WorldCupNotificationService } from '@/app/world-cup/tracking/notification';
import { WorldCupSubscriptionService } from '@/app/world-cup/tracking/subscription';
import { logger } from '@/infrastructure/logger';

export class WorldCupPollingService {
  static async pollAndDeliver({ bot }: { bot: WorldCupNotificationBot }) {
    const pollRunId = randomUUID();
    const startedAt = Date.now();

    logger.info({ pollRunId }, '[WORLD_CUP]: polling started');

    const games = await WorldCupApiClient.getGames();
    const result = {
      gamesChecked: games.length,
      eventsDetected: 0,
      eventsCreated: 0,
      deliveriesCreated: 0,
      deliveriesSkipped: 0,
      notificationTargets: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
    };

    logger.info({ pollRunId, gamesChecked: games.length }, '[WORLD_CUP]: games fetched');

    for (const current of games) {
      const previous = await WorldCupDbService.getSnapshot(current.gameId);
      const events = WorldCupEventDetector.detect({ previous, current });
      result.eventsDetected += events.length;

      if (events.length > 0) {
        logger.info(
          {
            pollRunId,
            gameId: current.gameId,
            matchLabel: `${current.homeTeamName} vs ${current.awayTeamName}`,
            score: `${current.homeScore}-${current.awayScore}`,
            eventKeys: events.map((event) => event.eventKey),
          },
          '[WORLD_CUP]: events detected',
        );
      }

      for (const event of events) {
        const created = await WorldCupDbService.createDetectedEvent(event);

        if (!created) {
          logger.debug(
            { pollRunId, eventKey: event.eventKey, eventType: event.eventType },
            '[WORLD_CUP]: detected event already recorded',
          );
          continue;
        }

        result.eventsCreated += 1;
        logger.info(
          {
            pollRunId,
            eventKey: event.eventKey,
            eventType: event.eventType,
            gameId: event.gameId,
            teamIds: event.teamIds,
          },
          '[WORLD_CUP]: detected event recorded',
        );

        const targets = await WorldCupSubscriptionService.findNotificationTargets(event);
        result.notificationTargets += targets.length;

        logger.info(
          {
            pollRunId,
            eventKey: event.eventKey,
            targetCount: targets.length,
            threadIds: targets.map((target) => target.threadId),
          },
          '[WORLD_CUP]: notification targets resolved',
        );

        for (const target of targets) {
          const delivery = await WorldCupDbService.createPendingDelivery({
            deliveryKey: `${event.eventKey}:${target.threadId}`,
            eventKey: event.eventKey,
            subscriptionId: target.subscriptionId,
            threadId: target.threadId,
          });

          if (!delivery) {
            result.deliveriesSkipped += 1;
            logger.debug(
              {
                pollRunId,
                eventKey: event.eventKey,
                subscriptionId: target.subscriptionId,
                threadId: target.threadId,
              },
              '[WORLD_CUP]: delivery already pending or sent',
            );
            continue;
          }

          result.deliveriesCreated += 1;
          logger.info(
            {
              pollRunId,
              deliveryId: delivery.id,
              eventKey: event.eventKey,
              subscriptionId: target.subscriptionId,
              identityId: target.identityId,
              threadId: target.threadId,
            },
            '[WORLD_CUP]: delivery created',
          );

          try {
            await WorldCupNotificationService.postNotification({
              bot,
              event,
              identityId: target.identityId,
              threadId: target.threadId,
            });
            await WorldCupDbService.markDeliverySent(delivery.id);
            result.notificationsSent += 1;
            logger.info(
              {
                pollRunId,
                deliveryId: delivery.id,
                eventKey: event.eventKey,
                threadId: target.threadId,
              },
              '[WORLD_CUP]: notification delivered',
            );
          } catch (error) {
            await WorldCupDbService.markDeliveryFailed(delivery.id, error);
            result.notificationsFailed += 1;
            logger.error(
              {
                error,
                pollRunId,
                deliveryId: delivery.id,
                eventKey: event.eventKey,
                threadId: target.threadId,
              },
              '[WORLD_CUP]: notification delivery failed',
            );
          }
        }
      }

      if (!previous) {
        logger.debug(
          {
            pollRunId,
            gameId: current.gameId,
            matchLabel: `${current.homeTeamName} vs ${current.awayTeamName}`,
          },
          '[WORLD_CUP]: initial game snapshot created',
        );
      }

      await WorldCupDbService.upsertSnapshot(current);
    }

    logger.info(
      { pollRunId, durationMs: Date.now() - startedAt, ...result },
      '[WORLD_CUP]: polling completed',
    );

    return result;
  }
}

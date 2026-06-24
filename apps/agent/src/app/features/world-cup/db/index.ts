import type {
  WorldCupApiGame,
  WorldCupDetectedEvent,
  WorldCupGameSnapshot,
} from '@/app/features/world-cup/types';

import { and, eq, isNull } from 'drizzle-orm';

import {
  worldCup2026DetectedEvents,
  worldCup2026EventDeliveries,
  worldCup2026GameSnapshots,
  worldCup2026Subscriptions,
} from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';

export type WorldCupSubscription = typeof worldCup2026Subscriptions.$inferSelect;

export class WorldCupDbService extends DbService {
  static async getGameSnapshot(gameId: string) {
    const [snapshot] = await this.client
      .select()
      .from(worldCup2026GameSnapshots)
      .where(eq(worldCup2026GameSnapshots.gameId, gameId))
      .limit(1);

    return snapshot
      ? ({ ...snapshot, raw: snapshot.raw as WorldCupApiGame } satisfies WorldCupGameSnapshot)
      : null;
  }

  static async upsertSnapshot(snapshot: WorldCupGameSnapshot) {
    await this.client
      .insert(worldCup2026GameSnapshots)
      .values({
        ...snapshot,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: worldCup2026GameSnapshots.gameId,
        set: {
          ...snapshot,
          updatedAt: new Date(),
        },
      });
  }

  static async createDetectedEvent(event: WorldCupDetectedEvent) {
    const [created] = await this.client
      .insert(worldCup2026DetectedEvents)
      .values(event)
      .onConflictDoNothing({
        target: worldCup2026DetectedEvents.eventKey,
      })
      .returning();

    return created ?? null;
  }

  static async getActiveSubscriptions() {
    return this.client
      .select()
      .from(worldCup2026Subscriptions)
      .where(eq(worldCup2026Subscriptions.active, true));
  }

  static async deactivateMatchingSubscriptions({
    identityId,
    threadId,
    scope,
    teamId,
  }: {
    identityId: string;
    threadId: string;
    scope?: WorldCupSubscription['scope'];
    teamId?: string | null;
  }) {
    const conditions = [
      eq(worldCup2026Subscriptions.identityId, identityId),
      eq(worldCup2026Subscriptions.threadId, threadId),
      eq(worldCup2026Subscriptions.active, true),
    ];

    if (scope) {
      conditions.push(eq(worldCup2026Subscriptions.scope, scope));
    }

    if (teamId !== undefined) {
      conditions.push(
        teamId === null
          ? isNull(worldCup2026Subscriptions.teamId)
          : eq(worldCup2026Subscriptions.teamId, teamId),
      );
    }

    const deactivated = await this.client
      .update(worldCup2026Subscriptions)
      .set({ active: false, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    return deactivated.length;
  }

  static async createSubscription(input: typeof worldCup2026Subscriptions.$inferInsert) {
    const [subscription] = await this.client
      .insert(worldCup2026Subscriptions)
      .values(input)
      .returning();

    return subscription ?? null;
  }

  static async createPendingDelivery({
    deliveryKey,
    eventKey,
    subscriptionId,
    threadId,
  }: {
    deliveryKey: string;
    eventKey: string;
    subscriptionId: string;
    threadId: string;
  }) {
    const pendingThreshold = Date.now() - 2 * 60 * 1000;
    const [delivery] = await this.client
      .insert(worldCup2026EventDeliveries)
      .values({
        deliveryKey,
        eventKey,
        subscriptionId,
        threadId,
        status: 'pending',
      })
      .onConflictDoNothing({
        target: worldCup2026EventDeliveries.deliveryKey,
      })
      .returning();

    if (delivery) {
      return {
        delivery,
        created: true as const,
        deliverable: true as const,
      };
    }

    const [existingDelivery] = await this.client
      .select()
      .from(worldCup2026EventDeliveries)
      .where(eq(worldCup2026EventDeliveries.deliveryKey, deliveryKey))
      .limit(1);

    if (!existingDelivery || existingDelivery.status === 'sent') {
      return {
        delivery: existingDelivery ?? null,
        created: false as const,
        deliverable: false as const,
      };
    }

    const canRetry =
      existingDelivery.status === 'failed' ||
      existingDelivery.createdAt.getTime() < pendingThreshold;

    if (!canRetry) {
      return {
        delivery: existingDelivery,
        created: false as const,
        deliverable: false as const,
      };
    }

    const [retryDelivery] = await this.client
      .update(worldCup2026EventDeliveries)
      .set({
        status: 'pending',
        error: null,
        deliveredAt: null,
      })
      .where(eq(worldCup2026EventDeliveries.id, existingDelivery.id))
      .returning();

    return {
      delivery: retryDelivery ?? existingDelivery,
      created: false as const,
      deliverable: true as const,
    };
  }

  static async markDeliverySent(deliveryId: string) {
    await this.client
      .update(worldCup2026EventDeliveries)
      .set({ status: 'sent', deliveredAt: new Date(), error: null })
      .where(eq(worldCup2026EventDeliveries.id, deliveryId));
  }

  static async markDeliveryFailed(deliveryId: string, error: unknown) {
    await this.client
      .update(worldCup2026EventDeliveries)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(worldCup2026EventDeliveries.id, deliveryId));
  }
}

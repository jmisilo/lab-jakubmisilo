import type {
  GoogleCalendarConnection,
  NewGoogleCalendarActionAudit,
  NewGoogleCalendarConnection,
  NewGoogleCalendarOauthState,
} from '@/types';

import { and, eq, gt, isNull, lte } from 'drizzle-orm';

import {
  agentGoogleCalendarActionAudit,
  agentGoogleCalendarConnections,
  agentGoogleCalendarOauthStates,
} from '@/infrastructure/db/schema';
import { DbService } from '@/infrastructure/db/services';

export class GoogleConnectionDbService extends DbService {
  static async createOauthState(input: NewGoogleCalendarOauthState) {
    const [state] = await this.client
      .insert(agentGoogleCalendarOauthStates)
      .values(input)
      .returning();

    return state ?? null;
  }

  static async getPendingOauthStateByRequestId({ requestId, now }: GetOauthStateByRequestIdInput) {
    const [state] = await this.client
      .select()
      .from(agentGoogleCalendarOauthStates)
      .where(
        and(
          eq(agentGoogleCalendarOauthStates.requestId, requestId),
          isNull(agentGoogleCalendarOauthStates.consumedAt),
          gt(agentGoogleCalendarOauthStates.expiresAt, now),
        ),
      )
      .limit(1);

    return state ?? null;
  }

  static async consumeOauthStateByHash({ stateHash, now }: ConsumeOauthStateByHashInput) {
    const [state] = await this.client
      .update(agentGoogleCalendarOauthStates)
      .set({ consumedAt: now })
      .where(
        and(
          eq(agentGoogleCalendarOauthStates.stateHash, stateHash),
          isNull(agentGoogleCalendarOauthStates.consumedAt),
          gt(agentGoogleCalendarOauthStates.expiresAt, now),
        ),
      )
      .returning();

    return state ?? null;
  }

  static async consumeExpiredOauthStateByRequestId({
    requestId,
    now,
  }: GetOauthStateByRequestIdInput) {
    const [state] = await this.client
      .update(agentGoogleCalendarOauthStates)
      .set({ consumedAt: now })
      .where(
        and(
          eq(agentGoogleCalendarOauthStates.requestId, requestId),
          isNull(agentGoogleCalendarOauthStates.consumedAt),
          lte(agentGoogleCalendarOauthStates.expiresAt, now),
        ),
      )
      .returning();

    return state ?? null;
  }

  static async getActiveConnection({ identityId }: { identityId: string }) {
    const [connection] = await this.client
      .select()
      .from(agentGoogleCalendarConnections)
      .where(
        and(
          eq(agentGoogleCalendarConnections.identityId, identityId),
          eq(agentGoogleCalendarConnections.status, 'active'),
        ),
      )
      .limit(1);

    return connection ?? null;
  }

  static async replaceActiveConnection(input: NewGoogleCalendarConnection) {
    return this.client.transaction(async (tx) => {
      const now = new Date();

      await tx
        .update(agentGoogleCalendarConnections)
        .set({
          status: 'revoked',
          revokedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentGoogleCalendarConnections.identityId, input.identityId),
            eq(agentGoogleCalendarConnections.status, 'active'),
          ),
        );

      const [connection] = await tx
        .insert(agentGoogleCalendarConnections)
        .values(input)
        .returning();

      return connection ?? null;
    });
  }

  static async markConnectionRevoked({ identityId, connectionId }: MarkConnectionInput) {
    const [connection] = await this.client
      .update(agentGoogleCalendarConnections)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentGoogleCalendarConnections.identityId, identityId),
          connectionId ? eq(agentGoogleCalendarConnections.id, connectionId) : undefined,
          eq(agentGoogleCalendarConnections.status, 'active'),
        ),
      )
      .returning();

    return connection ?? null;
  }

  static async markConnectionInvalid({ identityId, connectionId }: MarkConnectionInput) {
    const [connection] = await this.client
      .update(agentGoogleCalendarConnections)
      .set({
        status: 'invalid',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentGoogleCalendarConnections.identityId, identityId),
          connectionId ? eq(agentGoogleCalendarConnections.id, connectionId) : undefined,
          eq(agentGoogleCalendarConnections.status, 'active'),
        ),
      )
      .returning();

    return connection ?? null;
  }

  static async touchConnectionLastUsed({ identityId, connectionId }: MarkConnectionInput) {
    await this.client
      .update(agentGoogleCalendarConnections)
      .set({
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentGoogleCalendarConnections.identityId, identityId),
          connectionId ? eq(agentGoogleCalendarConnections.id, connectionId) : undefined,
          eq(agentGoogleCalendarConnections.status, 'active'),
        ),
      );
  }
}

export class GoogleCalendarAuditDbService extends DbService {
  static async recordAction(input: NewGoogleCalendarActionAudit) {
    const [audit] = await this.client
      .insert(agentGoogleCalendarActionAudit)
      .values(input)
      .returning();

    return audit ?? null;
  }
}

type GetOauthStateByRequestIdInput = {
  requestId: string;
  now: Date;
};

type ConsumeOauthStateByHashInput = {
  stateHash: string;
  now: Date;
};

type MarkConnectionInput = {
  identityId: string;
  connectionId?: GoogleCalendarConnection['id'];
};

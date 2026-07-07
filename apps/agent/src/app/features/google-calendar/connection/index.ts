import { createHash, randomBytes } from 'node:crypto';

import { UrlComposer } from '@labjm/utilities/url-composer';

import {
  GOOGLE_CALENDAR_CONNECTION_EXPIRES_IN_MINUTES,
  GOOGLE_CALENDAR_SCOPES,
} from '@/app/features/google-calendar/schemas';
import { GoogleCalendarDbService } from '@/infrastructure/db/services/google-calendar';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { GoogleOAuthService } from '@/infrastructure/google/oauth';
import { GoogleCalendarTokenEncryptionService } from '@/infrastructure/google/token-crypto';
import { logger } from '@/infrastructure/logger';

const OAUTH_STATE_BYTES = 32;

export class GoogleCalendarConnectionService {
  static async createConnectionRequest({
    identityId,
    threadId,
    sourceMessageId,
    now = new Date(),
  }: CreateConnectionRequestInput) {
    this.#assertConfigured();

    const requestId = this.#createOpaqueToken();
    const expiresAt = new Date(
      now.getTime() + GOOGLE_CALENDAR_CONNECTION_EXPIRES_IN_MINUTES * 60 * 1000,
    );
    const state = await GoogleCalendarDbService.createOauthState({
      requestId,
      stateHash: this.#hashState(requestId),
      identityId,
      threadId,
      sourceMessageId,
      scopes: [...GOOGLE_CALENDAR_SCOPES],
      expiresAt,
    });

    if (!state) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_INVALID,
        message: 'Google Calendar OAuth state could not be created.',
        context: { identityId, threadId },
        retryable: true,
        userMessage: 'I could not create a Calendar connection link. Please try again.',
      });
    }

    return {
      requestId,
      connectionUrl: this.#createConnectionUrl({ requestId }),
      expiresAt,
    };
  }

  static async getConnectionStatus({ identityId }: { identityId: string }) {
    const connection = await GoogleCalendarDbService.getActiveConnection({ identityId });

    return {
      connected: Boolean(connection),
      googleAccountEmail: connection?.googleAccountEmail ?? undefined,
      grantedScopes: connection?.grantedScopes ?? [],
      connectedAt: connection?.connectedAt,
      lastUsedAt: connection?.lastUsedAt ?? undefined,
    };
  }

  static async createAuthorizationUrl({
    requestId,
    now = new Date(),
  }: CreateAuthorizationUrlInput) {
    const state = await GoogleCalendarDbService.getPendingOauthStateByRequestId({
      requestId,
      now,
    });

    if (!state) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_EXPIRED,
        message: 'Google Calendar OAuth request was not found or expired.',
        context: { requestId },
        retryable: false,
        userMessage: 'That Calendar connection link expired. Ask me to connect Calendar again.',
      });
    }

    return GoogleOAuthService.createAuthorizationUrl({
      state: requestId,
      scopes: state.scopes,
    });
  }

  static async createReplacementConnectionRequestForExpiredRequest({
    requestId,
    now = new Date(),
  }: CreateReplacementConnectionRequestInput) {
    const expiredState = await GoogleCalendarDbService.consumeExpiredOauthStateByRequestId({
      requestId,
      now,
    });

    if (!expiredState) {
      return null;
    }

    const request = await this.createConnectionRequest({
      identityId: expiredState.identityId,
      threadId: expiredState.threadId,
      sourceMessageId: expiredState.sourceMessageId ?? undefined,
      now,
    });

    return {
      ...request,
      identityId: expiredState.identityId,
      threadId: expiredState.threadId,
      sourceMessageId: expiredState.sourceMessageId ?? undefined,
    };
  }

  static async completeConnection({ code, state, now = new Date() }: CompleteConnectionInput) {
    this.#assertConfigured();

    const oauthState = await GoogleCalendarDbService.consumeOauthStateByHash({
      stateHash: this.#hashState(state),
      now,
    });

    if (!oauthState) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_EXPIRED,
        message: 'Google Calendar OAuth state was not found, expired, or already consumed.',
        retryable: false,
        userMessage: 'That Calendar connection link expired. Ask me to connect Calendar again.',
      });
    }

    const token = await GoogleOAuthService.exchangeCode({ code });

    if (!token.refreshToken) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_INVALID,
        message: 'Google OAuth token response did not include a refresh token.',
        context: { identityId: oauthState.identityId },
        retryable: false,
        userMessage:
          'Google did not return long-term Calendar access. Please try connecting again.',
      });
    }

    this.#assertRequiredScopes({
      grantedScopes: token.scopes,
      requiredScopes: oauthState.scopes,
      identityId: oauthState.identityId,
    });

    const encryptedToken = GoogleCalendarTokenEncryptionService.encryptToken(token.refreshToken);
    const connection = await GoogleCalendarDbService.replaceActiveConnection({
      identityId: oauthState.identityId,
      status: 'active',
      encryptedRefreshToken: encryptedToken.encryptedRefreshToken,
      refreshTokenIv: encryptedToken.refreshTokenIv,
      refreshTokenAuthTag: encryptedToken.refreshTokenAuthTag,
      grantedScopes: token.scopes,
      connectedAt: now,
      metadata: {
        tokenType: token.tokenType,
        tokenExpiresIn: token.expiresIn,
      },
    });

    if (!connection) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_INVALID,
        message: 'Google Calendar connection could not be stored.',
        context: { identityId: oauthState.identityId },
        retryable: true,
        userMessage: 'Google Calendar connected, but I could not save the connection.',
      });
    }

    return {
      connection,
      identityId: oauthState.identityId,
      threadId: oauthState.threadId,
      sourceMessageId: oauthState.sourceMessageId ?? undefined,
    };
  }

  static async disconnect({ identityId }: { identityId: string }) {
    const connection = await GoogleCalendarDbService.getActiveConnection({ identityId });

    if (!connection) {
      return { disconnected: false, revocationOk: true };
    }

    const refreshToken = GoogleCalendarTokenEncryptionService.decryptToken(connection);
    let revocationOk = true;

    try {
      await GoogleOAuthService.revokeToken({ token: refreshToken });
    } catch (error) {
      revocationOk = false;
      logger.warn(
        {
          identityId,
          connectionId: connection.id,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: token revocation failed',
      );
    }

    await GoogleCalendarDbService.markConnectionRevoked({
      identityId,
      connectionId: connection.id,
    });

    return { disconnected: true, revocationOk };
  }

  static async getAccessToken({ identityId }: { identityId: string }) {
    const connection = await GoogleCalendarDbService.getActiveConnection({ identityId });

    if (!connection) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_CONNECTION_REQUIRED,
        message: 'Google Calendar connection is required.',
        context: { identityId },
        retryable: false,
        userMessage: 'Google Calendar is not connected yet. Ask me to connect Calendar first.',
      });
    }

    try {
      const refreshToken = GoogleCalendarTokenEncryptionService.decryptToken(connection);
      const accessToken = await GoogleOAuthService.refreshAccessToken({ refreshToken });

      await GoogleCalendarDbService.touchConnectionLastUsed({
        identityId,
        connectionId: connection.id,
      });

      return accessToken;
    } catch (error) {
      if (
        AppError.is(error) &&
        !error.retryable &&
        error.code === AppErrorCode.GOOGLE_CALENDAR_TOKEN_INVALID
      ) {
        await GoogleCalendarDbService.markConnectionInvalid({
          identityId,
          connectionId: connection.id,
        });
      }

      throw error;
    }
  }

  static #assertRequiredScopes({
    grantedScopes,
    requiredScopes,
    identityId,
  }: {
    grantedScopes: string[];
    requiredScopes: string[];
    identityId: string;
  }) {
    const grantedScopeSet = new Set(grantedScopes);
    const missingScopes = requiredScopes.filter((scope) => !grantedScopeSet.has(scope));

    if (missingScopes.length > 0) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_INVALID,
        message: 'Google Calendar OAuth response did not include required scopes.',
        context: {
          identityId,
          missingScopes,
        },
        retryable: false,
        userMessage: 'Google Calendar access was missing required permissions. Please reconnect.',
      });
    }
  }

  static #assertConfigured() {
    GoogleOAuthService.assertConfigured();
    GoogleCalendarTokenEncryptionService.assertConfigured();
  }

  static #createConnectionUrl({ requestId }: { requestId: string }) {
    return this.#getPublicUrlComposer().compose({
      pathSegments: ['/links', '/google-calendar', '/connect', requestId],
    });
  }

  static #getPublicUrlComposer() {
    const explicitUrl = process.env.AGENT_PUBLIC_URL;

    if (explicitUrl) {
      return this.#createUrlComposerFromBaseUrl(explicitUrl);
    }

    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (redirectUri) {
      return this.#createUrlComposerFromBaseUrl(redirectUri);
    }

    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;

    if (vercelUrl) {
      return this.#createUrlComposerFromBaseUrl(vercelUrl);
    }

    throw new AppError({
      code: AppErrorCode.GOOGLE_CALENDAR_OAUTH_INVALID,
      message: 'Agent public URL could not be resolved for Google Calendar links.',
      retryable: false,
      userMessage: 'Google Calendar is not configured yet.',
    });
  }

  static #createUrlComposerFromBaseUrl(baseUrl: string) {
    const parsedBaseUrl = new URL(/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
    const protocol = parsedBaseUrl.protocol === 'http:' ? 'http' : 'https';

    return new UrlComposer(parsedBaseUrl.host, protocol);
  }

  static #createOpaqueToken() {
    return randomBytes(OAUTH_STATE_BYTES).toString('base64url');
  }

  static #hashState(state: string) {
    return createHash('sha256').update(state).digest('hex');
  }
}

type CreateConnectionRequestInput = {
  identityId: string;
  threadId: string;
  sourceMessageId?: string;
  now?: Date;
};

type CreateAuthorizationUrlInput = {
  requestId: string;
  now?: Date;
};

type CreateReplacementConnectionRequestInput = {
  requestId: string;
  now?: Date;
};

type CompleteConnectionInput = {
  code: string;
  state: string;
  now?: Date;
};

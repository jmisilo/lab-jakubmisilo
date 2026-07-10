import type { GoogleService } from '@/app/features/google/types';

import { createHash, randomBytes } from 'node:crypto';

import { UrlComposer } from '@labjm/utilities/url-composer';

import {
  GOOGLE_CONNECTION_EXPIRES_IN_MINUTES,
  GOOGLE_SERVICE_SCOPES,
} from '@/app/features/google/schemas';
import { GoogleCalendarDbService } from '@/infrastructure/db/services/google-calendar';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { GoogleOAuthService } from '@/infrastructure/google/oauth';
import { GoogleTokenEncryptionService } from '@/infrastructure/google/token-crypto';
import { logger } from '@/infrastructure/logger';

const OAUTH_STATE_BYTES = 32;

export class GoogleConnectionService {
  static async createConnectionRequest({
    identityId,
    threadId,
    sourceMessageId,
    services,
    now = new Date(),
  }: CreateConnectionRequestInput) {
    this.#assertConfigured();

    const requestId = this.#createOpaqueToken();
    const expiresAt = new Date(now.getTime() + GOOGLE_CONNECTION_EXPIRES_IN_MINUTES * 60 * 1000);
    const existingConnection = await GoogleCalendarDbService.getActiveConnection({ identityId });
    const requestedScopes = this.#getRequiredScopes(services);
    const scopes = [...new Set([...(existingConnection?.grantedScopes ?? []), ...requestedScopes])];
    const state = await GoogleCalendarDbService.createOauthState({
      requestId,
      stateHash: this.#hashState(requestId),
      identityId,
      threadId,
      sourceMessageId,
      scopes,
      expiresAt,
    });

    if (!state) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_OAUTH_INVALID,
        message: 'Google OAuth state could not be created.',
        context: { identityId, threadId, services },
        retryable: true,
        userMessage: 'I could not create a Google connection link. Please try again.',
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
      connectedServices: this.#getConnectedServices(connection?.grantedScopes ?? []),
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
        code: AppErrorCode.GOOGLE_OAUTH_EXPIRED,
        message: 'Google OAuth request was not found or expired.',
        context: { requestId },
        retryable: false,
        userMessage: 'That Google connection link expired. Ask me to connect again.',
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
      services: this.#getConnectedServices(expiredState.scopes),
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
        code: AppErrorCode.GOOGLE_OAUTH_EXPIRED,
        message: 'Google OAuth state was not found, expired, or already consumed.',
        retryable: false,
        userMessage: 'That Google connection link expired. Ask me to connect again.',
      });
    }

    const token = await GoogleOAuthService.exchangeCode({ code });

    if (!token.refreshToken) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_OAUTH_INVALID,
        message: 'Google OAuth token response did not include a refresh token.',
        context: { identityId: oauthState.identityId },
        retryable: false,
        userMessage: 'Google did not return long-term access. Please try connecting again.',
      });
    }

    this.#assertRequiredScopes({
      grantedScopes: token.scopes,
      requiredScopes: oauthState.scopes,
      identityId: oauthState.identityId,
    });

    const encryptedToken = GoogleTokenEncryptionService.encryptToken(token.refreshToken);
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
        code: AppErrorCode.GOOGLE_OAUTH_INVALID,
        message: 'Google connection could not be stored.',
        context: { identityId: oauthState.identityId },
        retryable: true,
        userMessage: 'Google connected, but I could not save the connection.',
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

    const refreshToken = GoogleTokenEncryptionService.decryptToken(connection);
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
        '[GOOGLE]: token revocation failed',
      );
    }

    await GoogleCalendarDbService.markConnectionRevoked({
      identityId,
      connectionId: connection.id,
    });

    return { disconnected: true, revocationOk };
  }

  static async getAccessToken({ identityId, service }: GetAccessTokenInput) {
    const connection = await GoogleCalendarDbService.getActiveConnection({ identityId });

    if (!connection) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CONNECTION_REQUIRED,
        message: 'Google connection is required.',
        context: { identityId, service },
        retryable: false,
        userMessage: `Google ${this.#getServiceName(service)} is not connected yet.`,
      });
    }

    this.#assertRequiredScopes({
      grantedScopes: connection.grantedScopes,
      requiredScopes: this.#getRequiredScopes([service]),
      identityId,
    });

    try {
      const refreshToken = GoogleTokenEncryptionService.decryptToken(connection);
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
        error.code === AppErrorCode.GOOGLE_TOKEN_INVALID
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
        code: AppErrorCode.GOOGLE_PERMISSION_REQUIRED,
        message: 'Google OAuth response did not include required scopes.',
        context: {
          identityId,
          missingScopes,
        },
        retryable: false,
        userMessage: 'Google access is missing the required permission. Please reconnect.',
      });
    }
  }

  static #assertConfigured() {
    GoogleOAuthService.assertConfigured();
    GoogleTokenEncryptionService.assertConfigured();
  }

  static #createConnectionUrl({ requestId }: { requestId: string }) {
    return this.#getPublicUrlComposer().compose({
      pathSegments: ['/links', '/google', '/connect', requestId],
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
      code: AppErrorCode.GOOGLE_OAUTH_INVALID,
      message: 'Agent public URL could not be resolved for Google links.',
      retryable: false,
      userMessage: 'Google is not configured yet.',
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

  static #getRequiredScopes(services: readonly GoogleService[]) {
    return services.flatMap((service) => GOOGLE_SERVICE_SCOPES[service]);
  }

  static #getConnectedServices(grantedScopes: readonly string[]): GoogleService[] {
    const granted = new Set(grantedScopes);

    return (Object.keys(GOOGLE_SERVICE_SCOPES) as GoogleService[]).filter((service) =>
      GOOGLE_SERVICE_SCOPES[service].every((scope) => granted.has(scope)),
    );
  }

  static #getServiceName(service: GoogleService) {
    return service === 'calendar' ? 'Calendar' : 'Gmail';
  }
}

type CreateConnectionRequestInput = {
  identityId: string;
  threadId: string;
  sourceMessageId?: string;
  services: GoogleService[];
  now?: Date;
};

type GetAccessTokenInput = {
  identityId: string;
  service: GoogleService;
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

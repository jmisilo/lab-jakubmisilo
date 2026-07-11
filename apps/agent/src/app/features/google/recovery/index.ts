import type { GoogleService } from '@/app/features/google/types';
import type { AppErrorCode } from '@/infrastructure/errors';

import { GoogleConnectionService } from '@/app/features/google/connection';
import { AppError, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const RECONNECT_MESSAGES = {
  calendar: {
    not_connected: 'Google Calendar is not connected yet.',
    permission_missing: 'The Google connection does not include Calendar access.',
    access_expired_or_revoked: 'Google Calendar access expired or was revoked.',
    connection_link_expired: 'The previous Google Calendar connection link expired.',
  },
  gmail: {
    not_connected: 'Gmail is not connected yet.',
    permission_missing: 'The Google connection does not include Gmail read access.',
    access_expired_or_revoked: 'Google access expired or was revoked.',
    connection_link_expired: 'The previous Google connection link expired.',
  },
} as const;

export class GoogleConnectionRecoveryService {
  static async createToolFailure({
    error,
    fallbackCode,
    fallbackMessage,
    identityId,
    threadId,
    sourceMessageId,
    service,
    operation,
  }: CreateToolFailureInput) {
    const failure = ErrorService.toUserFacingFailure(error, {
      fallbackCode,
      fallbackMessage,
    });
    const reconnectReason = this.#getReconnectReason(error);

    if (!reconnectReason || !threadId) {
      return { ok: false as const, message: failure.message };
    }

    try {
      const request = await GoogleConnectionService.createConnectionRequest({
        identityId,
        threadId,
        sourceMessageId,
        services: [service],
      });

      logger.info(
        {
          identityId,
          threadId,
          service,
          operation,
          reconnectReason,
          expiresAt: request.expiresAt,
        },
        '[GOOGLE]: reconnect link created after tool failure',
      );

      return {
        ok: false as const,
        message: `${RECONNECT_MESSAGES[service][reconnectReason]} Use this link to reconnect: ${request.connectionUrl}`,
        connectionUrl: request.connectionUrl,
        expiresAt: request.expiresAt.toISOString(),
        reconnectReason,
      };
    } catch (recoveryError) {
      logger.error(
        {
          identityId,
          threadId,
          service,
          operation,
          reconnectReason,
          safeError: ErrorService.toSafeLog(recoveryError),
        },
        '[GOOGLE]: reconnect link creation failed after tool failure',
      );

      return { ok: false as const, message: failure.message };
    }
  }

  static #getReconnectReason(error: unknown): GoogleReconnectReason | null {
    if (!AppError.is(error) || error.retryable) {
      return null;
    }

    if (error.code === 'GOOGLE_CONNECTION_REQUIRED') {
      return 'not_connected';
    }

    if (error.code === 'GOOGLE_PERMISSION_REQUIRED') {
      return 'permission_missing';
    }

    if (error.code === 'GOOGLE_TOKEN_INVALID') {
      return 'access_expired_or_revoked';
    }

    if (error.code === 'GOOGLE_OAUTH_EXPIRED') {
      return 'connection_link_expired';
    }

    return null;
  }
}

type CreateToolFailureInput = {
  error: unknown;
  fallbackCode: AppErrorCode;
  fallbackMessage: string;
  identityId: string;
  threadId?: string;
  sourceMessageId?: string;
  service: GoogleService;
  operation: string;
};

type GoogleReconnectReason = keyof (typeof RECONNECT_MESSAGES)['calendar'];

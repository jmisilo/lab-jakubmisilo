import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import { GoogleConnectionService } from '@/app/features/google/connection';
import {
  GoogleConnectionToolOutputSchema,
  GoogleToolContextSchema,
  ManageGoogleConnectionToolInputSchema,
} from '@/app/features/google/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const DEFAULT_GOOGLE_SERVICES = ['calendar', 'gmail'] as const;

export const manageGoogleConnectionTool: ManageGoogleConnectionTool = tool({
  description: dedent`
    Connect, disconnect, or inspect Google access for the current user. One Google connection can grant Calendar, Gmail, or both.

    # When To Use
    - The user asks to connect Google Calendar or Gmail.
    - A Google read/write tool reports missing, expired, revoked, or insufficient access.
    - The user asks which Google services are connected.
    - The user asks to disconnect Google access completely.

    # Usage
    - For a normal connect request, omit services so both Calendar and Gmail are connected by default.
    - Request a specific service only when recovering a missing permission for that service. Existing grants are preserved through incremental authorization.
    - Send the returned connectionUrl to the user and mention that it expires soon.
    - Disconnect revokes the combined Google grant, so it disconnects both Calendar and Gmail.
    - Never say access is connected until this tool or the OAuth callback confirms it.
  `,
  inputSchema: ManageGoogleConnectionToolInputSchema,
  outputSchema: GoogleConnectionToolOutputSchema,
  contextSchema: GoogleToolContextSchema,
  execute: async (input, { context }) => {
    try {
      if (input.action === 'status') {
        const status = await GoogleConnectionService.getConnectionStatus({
          identityId: context.identityId,
        });

        return {
          ok: true,
          message: status.connected ? 'Google is connected.' : 'Google is not connected.',
          connected: status.connected,
          connectedServices: status.connectedServices,
          googleAccountEmail: status.googleAccountEmail,
        };
      }

      if (input.action === 'connect') {
        if (!context.threadId) {
          return { ok: false, message: 'Google connection links require a chat thread.' };
        }

        const services = input.services ?? [...DEFAULT_GOOGLE_SERVICES];
        const request = await GoogleConnectionService.createConnectionRequest({
          identityId: context.identityId,
          threadId: context.threadId,
          sourceMessageId: context.sourceMessageId,
          services,
        });

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            services,
            expiresAt: request.expiresAt,
          },
          '[GOOGLE]: connection link created',
        );

        return {
          ok: true,
          message: 'Google connection link created.',
          connected: false,
          connectionUrl: request.connectionUrl,
          expiresAt: request.expiresAt.toISOString(),
        };
      }

      const result = await GoogleConnectionService.disconnect({ identityId: context.identityId });

      logger.info(
        {
          identityId: context.identityId,
          disconnected: result.disconnected,
          revocationOk: result.revocationOk,
        },
        '[GOOGLE]: disconnected',
      );

      return {
        ok: true,
        message: result.disconnected ? 'Google is disconnected.' : 'Google was not connected.',
        connected: false,
        connectedServices: [],
      };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          action: input.action,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE]: connection tool failed',
      );
      const failure = ErrorService.toUserFacingFailure(error, {
        fallbackCode: 'GOOGLE_API_ERROR',
        fallbackMessage: 'Google connection request failed.',
      });

      return { ok: false, message: failure.message };
    }
  },
});

export type ManageGoogleConnectionTool = Tool<
  z.infer<typeof ManageGoogleConnectionToolInputSchema>,
  z.infer<typeof GoogleConnectionToolOutputSchema>,
  z.infer<typeof GoogleToolContextSchema>
>;

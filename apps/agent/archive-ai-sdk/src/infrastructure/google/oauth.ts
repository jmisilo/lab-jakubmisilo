import { z } from 'zod';

import { UrlComposer } from '@labjm/utilities/url-composer';

import { AppError, AppErrorCode } from '@/infrastructure/errors';

const GOOGLE_OAUTH_TIMEOUT_MS = 10_000;

const GoogleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

export class GoogleOAuthService {
  static #authorizationUrl = new UrlComposer('accounts.google.com', 'https');
  static #oauthUrl = new UrlComposer('oauth2.googleapis.com', 'https');

  static assertConfigured() {
    this.#getClientId();
    this.#getClientSecret();
    this.getRedirectUri();
  }

  static createAuthorizationUrl({ state, scopes }: CreateAuthorizationUrlInput) {
    const clientId = this.#getClientId();
    const redirectUri = this.getRedirectUri();

    return this.#authorizationUrl.compose({
      pathSegments: ['/o', '/oauth2', '/v2', '/auth'],
      queryParams: {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
        access_type: 'offline',
        include_granted_scopes: true,
        prompt: 'consent',
      },
    });
  }

  static async exchangeCode({ code }: { code: string }) {
    return this.#requestToken({
      parameters: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.getRedirectUri(),
      },
      failureCode: AppErrorCode.GOOGLE_OAUTH_INVALID,
      failureUserMessage: 'Google connection failed. Please try again.',
    });
  }

  static async refreshAccessToken({ refreshToken }: { refreshToken: string }) {
    const token = await this.#requestToken({
      parameters: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      failureCode: AppErrorCode.GOOGLE_TOKEN_INVALID,
      failureUserMessage: 'Google access expired or was revoked. Please reconnect.',
    });

    return token.accessToken;
  }

  static async revokeToken({ token }: { token: string }) {
    const response = await this.#fetchWithTimeout(
      this.#oauthUrl.compose({ pathSegments: ['/revoke'] }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ token }),
      },
    );

    if (response.ok) {
      return;
    }

    throw new AppError({
      code: AppErrorCode.GOOGLE_OAUTH_INVALID,
      message: 'Google OAuth token revocation failed.',
      context: { status: response.status },
      retryable: response.status >= 500,
      userMessage: 'Google was disconnected locally, but token revocation failed.',
    });
  }

  static getRedirectUri() {
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!redirectUri) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        message: 'GOOGLE_OAUTH_REDIRECT_URI is not configured.',
        retryable: false,
        userMessage: 'Google is not configured yet.',
      });
    }

    return redirectUri;
  }

  static async #requestToken({ parameters, failureCode, failureUserMessage }: RequestTokenInput) {
    const response = await this.#fetchWithTimeout(
      this.#oauthUrl.compose({ pathSegments: ['/token'] }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.#getClientId(),
          client_secret: this.#getClientSecret(),
          ...parameters,
        }),
      },
    );

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new AppError({
        code: failureCode,
        message: 'Google OAuth token request failed.',
        context: { status: response.status },
        retryable: response.status >= 500,
        userMessage: failureUserMessage,
      });
    }

    const parsed = GoogleTokenResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AppError({
        code: failureCode,
        message: 'Google OAuth token response was invalid.',
        context: { issues: parsed.error.issues },
        retryable: false,
        userMessage: failureUserMessage,
      });
    }

    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresIn: parsed.data.expires_in,
      scopes: this.#parseScope(parsed.data.scope),
      tokenType: parsed.data.token_type,
    };
  }

  static async #fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, GOOGLE_OAUTH_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw AppError.timeout({
          code: AppErrorCode.GOOGLE_API_TIMEOUT,
          message: 'Google OAuth request timed out.',
          cause: error,
          timeoutMs: GOOGLE_OAUTH_TIMEOUT_MS,
          userMessage: 'Google is temporarily unavailable. Please try again.',
        });
      }

      throw new AppError({
        code: AppErrorCode.GOOGLE_API_ERROR,
        message: 'Google OAuth request failed before receiving a response.',
        cause: error,
        retryable: true,
        userMessage: 'Google is temporarily unavailable. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  static #parseScope(scope?: string) {
    return [...new Set((scope ?? '').split(/\s+/g).filter(Boolean))];
  }

  static #getClientId() {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

    if (!clientId) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        message: 'GOOGLE_OAUTH_CLIENT_ID is not configured.',
        retryable: false,
        userMessage: 'Google is not configured yet.',
      });
    }

    return clientId;
  }

  static #getClientSecret() {
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    if (!clientSecret) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        message: 'GOOGLE_OAUTH_CLIENT_SECRET is not configured.',
        retryable: false,
        userMessage: 'Google is not configured yet.',
      });
    }

    return clientSecret;
  }
}

type CreateAuthorizationUrlInput = {
  state: string;
  scopes: string[];
};

type RequestTokenInput = {
  parameters: Record<string, string>;
  failureCode: AppErrorCode;
  failureUserMessage: string;
};

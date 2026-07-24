import type { ZodType } from 'zod';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { database } from '../../../infrastructure/database';
import { googleConnections, googleOauthStates } from '../../../infrastructure/database/schema';
import {
  GOOGLE_SCOPES,
  GoogleCalendarEventSchema,
  GoogleCalendarEventsResponseSchema,
  GoogleCalendarListResponseSchema,
  GoogleFreeBusyResponseSchema,
  GoogleGmailMessageSchema,
  GoogleGmailSearchResponseSchema,
  GoogleTokenResponseSchema,
} from './schemas';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
const GMAIL_BODY_MAX_CHARACTERS = 8_000;

export class GoogleService {
  static async createConnection({ resourceId, threadId }: ConnectionOwnerInput) {
    this.#assertConfigured();
    const requestId = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

    await database.insert(googleOauthStates).values({
      requestId,
      stateHash: this.#hash(requestId),
      resourceId,
      threadId,
      expiresAt,
    });

    return {
      connectionUrl: new URL(`/links/google/connect/${requestId}`, this.#publicUrl).toString(),
      expiresAt,
    };
  }

  static async getConnectionStatus(resourceId: string) {
    const connection = await this.#getActiveConnection(resourceId);

    return {
      connected: Boolean(connection),
      grantedScopes: connection?.grantedScopes ?? [],
      connectedAt: connection?.connectedAt,
      lastUsedAt: connection?.lastUsedAt,
    };
  }

  static async createAuthorizationUrl(requestId: string) {
    const [state] = await database
      .select()
      .from(googleOauthStates)
      .where(
        and(
          eq(googleOauthStates.requestId, requestId),
          isNull(googleOauthStates.consumedAt),
          gt(googleOauthStates.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!state) {
      throw new Error('That Google connection link is invalid or expired.');
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.#requiredEnvironment('GOOGLE_OAUTH_CLIENT_ID'),
      redirect_uri: this.#requiredEnvironment('GOOGLE_OAUTH_REDIRECT_URI'),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: GOOGLE_SCOPES.join(' '),
      state: requestId,
    }).toString();

    return url.toString();
  }

  static async completeConnection({ code, state }: CompleteConnectionInput) {
    const now = new Date();
    const [oauthState] = await database
      .update(googleOauthStates)
      .set({ consumedAt: now })
      .where(
        and(
          eq(googleOauthStates.stateHash, this.#hash(state)),
          isNull(googleOauthStates.consumedAt),
          gt(googleOauthStates.expiresAt, now),
        ),
      )
      .returning();

    if (!oauthState) {
      throw new Error('That Google connection request is invalid, expired, or already used.');
    }

    const token = await this.#requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#requiredEnvironment('GOOGLE_OAUTH_REDIRECT_URI'),
    });

    if (!token.refresh_token) {
      throw new Error('Google did not provide long-term access. Please connect again.');
    }

    const grantedScopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
    const missingScopes = GOOGLE_SCOPES.filter((scope) => !grantedScopes.includes(scope));

    if (missingScopes.length > 0) {
      throw new Error('Google did not grant all required Calendar and Gmail permissions.');
    }

    const encrypted = this.#encrypt(token.refresh_token);

    await database.transaction(async (transaction) => {
      await transaction
        .update(googleConnections)
        .set({ status: 'revoked', updatedAt: now })
        .where(
          and(
            eq(googleConnections.resourceId, oauthState.resourceId),
            eq(googleConnections.status, 'active'),
          ),
        );

      await transaction.insert(googleConnections).values({
        resourceId: oauthState.resourceId,
        encryptedRefreshToken: encrypted.value,
        refreshTokenIv: encrypted.iv,
        refreshTokenAuthTag: encrypted.authTag,
        grantedScopes,
        connectedAt: now,
      });
    });

    return {
      resourceId: oauthState.resourceId,
      threadId: oauthState.threadId,
    };
  }

  static async disconnect(resourceId: string) {
    const connection = await this.#getActiveConnection(resourceId);

    if (!connection) {
      return false;
    }

    const refreshToken = this.#decrypt(connection);

    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (error) {
      console.warn('[GOOGLE]: token revocation request failed', error);
    }

    await database
      .update(googleConnections)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(googleConnections.id, connection.id), eq(googleConnections.status, 'active')));

    return true;
  }

  static async searchGmail({ resourceId, query, maxResults }: SearchGmailInput) {
    const response = await this.#apiRequest({
      resourceId,
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
        q: query,
        maxResults: String(maxResults),
      })}`,
      schema: GoogleGmailSearchResponseSchema,
    });

    return Promise.all(
      response.messages.map(({ id }) => this.readGmailMessage({ resourceId, messageId: id })),
    );
  }

  static async readGmailMessage({ resourceId, messageId }: ReadGmailMessageInput) {
    const message = await this.#apiRequest({
      resourceId,
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
      schema: GoogleGmailMessageSchema,
    });
    const headers = Object.fromEntries(
      message.payload.headers.map(({ name, value }) => [name.toLowerCase(), value]),
    );

    return {
      id: message.id,
      threadId: message.threadId,
      subject: headers.subject,
      from: headers.from,
      to: headers.to,
      date: headers.date,
      snippet: message.snippet,
      body: this.#extractGmailBody(message.payload).slice(0, GMAIL_BODY_MAX_CHARACTERS),
    };
  }

  static async listCalendars(resourceId: string) {
    const response = await this.#apiRequest({
      resourceId,
      url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      schema: GoogleCalendarListResponseSchema,
    });

    return response.items;
  }

  static async listCalendarEvents(input: ListCalendarEventsInput) {
    const query = new URLSearchParams({
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(input.maxResults),
    });

    if (input.query) {
      query.set('q', input.query);
    }

    const response = await this.#apiRequest({
      resourceId: input.resourceId,
      url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?${query}`,
      schema: GoogleCalendarEventsResponseSchema,
    });

    return response.items;
  }

  static async getFreeBusy(input: FreeBusyInput) {
    return this.#apiRequest({
      resourceId: input.resourceId,
      url: 'https://www.googleapis.com/calendar/v3/freeBusy',
      method: 'POST',
      body: {
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        items: input.calendarIds.map((id) => ({ id })),
      },
      schema: GoogleFreeBusyResponseSchema,
    });
  }

  static async createCalendarEvent(input: CreateCalendarEventInput) {
    return this.#apiRequest({
      resourceId: input.resourceId,
      url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
      method: 'POST',
      body: input.event,
      schema: GoogleCalendarEventSchema,
    });
  }

  static async updateCalendarEvent(input: UpdateCalendarEventInput) {
    return this.#apiRequest({
      resourceId: input.resourceId,
      url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      method: 'PATCH',
      body: input.updates,
      schema: GoogleCalendarEventSchema,
    });
  }

  static async deleteCalendarEvent(input: DeleteCalendarEventInput) {
    await this.#apiRequest({
      resourceId: input.resourceId,
      url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      method: 'DELETE',
    });
  }

  static async #apiRequest<T>({
    resourceId,
    url,
    method = 'GET',
    body,
    schema,
  }: GoogleApiRequestInput<T>) {
    const accessToken = await this.#getAccessToken(resourceId);
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await database
          .update(googleConnections)
          .set({ status: 'invalid', updatedAt: new Date() })
          .where(
            and(
              eq(googleConnections.resourceId, resourceId),
              eq(googleConnections.status, 'active'),
            ),
          );
        throw new Error('Google access expired or lacks permission. Please reconnect Google.');
      }

      throw new Error(`Google request failed with status ${response.status}.`);
    }

    if (!schema || response.status === 204) {
      return undefined as T;
    }

    return schema.parse(await response.json());
  }

  static async #getAccessToken(resourceId: string) {
    const connection = await this.#getActiveConnection(resourceId);

    if (!connection) {
      throw new Error('Google is not connected. Connect Google first.');
    }

    try {
      const token = await this.#requestToken({
        grant_type: 'refresh_token',
        refresh_token: this.#decrypt(connection),
      });

      await database
        .update(googleConnections)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(googleConnections.id, connection.id));

      return token.access_token;
    } catch (error) {
      await database
        .update(googleConnections)
        .set({ status: 'invalid', updatedAt: new Date() })
        .where(eq(googleConnections.id, connection.id));
      throw error;
    }
  }

  static async #requestToken(parameters: Record<string, string>) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.#requiredEnvironment('GOOGLE_OAUTH_CLIENT_ID'),
        client_secret: this.#requiredEnvironment('GOOGLE_OAUTH_CLIENT_SECRET'),
        ...parameters,
      }),
    });

    if (!response.ok) {
      throw new Error('Google token exchange failed. Please reconnect Google.');
    }

    return GoogleTokenResponseSchema.parse(await response.json());
  }

  static async #getActiveConnection(resourceId: string) {
    const [connection] = await database
      .select()
      .from(googleConnections)
      .where(
        and(eq(googleConnections.resourceId, resourceId), eq(googleConnections.status, 'active')),
      )
      .limit(1);

    return connection;
  }

  static #encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

    return {
      value: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  static #decrypt(connection: {
    encryptedRefreshToken: string;
    refreshTokenIv: string;
    refreshTokenAuthTag: string;
  }) {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.#encryptionKey,
      Buffer.from(connection.refreshTokenIv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(connection.refreshTokenAuthTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(connection.encryptedRefreshToken, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  static get #encryptionKey() {
    const key = Buffer.from(this.#requiredEnvironment('GOOGLE_TOKEN_ENCRYPTION_KEY'), 'base64');

    if (key.byteLength !== 32) {
      throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }

    return key;
  }

  static get #publicUrl() {
    const value =
      process.env.AGENT_PUBLIC_URL ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL;

    if (!value) {
      throw new Error('Agent public URL is required for Google connection links.');
    }

    return value.startsWith('http') ? value : `https://${value}`;
  }

  static #assertConfigured() {
    this.#requiredEnvironment('GOOGLE_OAUTH_CLIENT_ID');
    this.#requiredEnvironment('GOOGLE_OAUTH_CLIENT_SECRET');
    this.#requiredEnvironment('GOOGLE_OAUTH_REDIRECT_URI');
    void this.#encryptionKey;
    void this.#publicUrl;
  }

  static #requiredEnvironment(name: string) {
    const value = process.env[name]?.trim();

    if (!value) {
      throw new Error(`${name} is required for Google integration.`);
    }

    return value;
  }

  static #hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  static #extractGmailBody(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const candidate = payload as {
      mimeType?: unknown;
      body?: { data?: unknown };
      parts?: unknown[];
    };

    if (candidate.mimeType === 'text/plain' && typeof candidate.body?.data === 'string') {
      return Buffer.from(candidate.body.data, 'base64url').toString('utf8');
    }

    for (const part of candidate.parts ?? []) {
      const body = this.#extractGmailBody(part);

      if (body) {
        return body;
      }
    }

    if (typeof candidate.body?.data === 'string') {
      return Buffer.from(candidate.body.data, 'base64url').toString('utf8');
    }

    return '';
  }
}

type ConnectionOwnerInput = {
  resourceId: string;
  threadId: string;
};

type CompleteConnectionInput = {
  code: string;
  state: string;
};

type SearchGmailInput = {
  resourceId: string;
  query: string;
  maxResults: number;
};

type ReadGmailMessageInput = {
  resourceId: string;
  messageId: string;
};

type ListCalendarEventsInput = {
  resourceId: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  query?: string;
  maxResults: number;
};

type FreeBusyInput = {
  resourceId: string;
  calendarIds: string[];
  timeMin: string;
  timeMax: string;
};

type CalendarEventInput = {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
};

type CreateCalendarEventInput = {
  resourceId: string;
  calendarId: string;
  event: CalendarEventInput;
};

type UpdateCalendarEventInput = {
  resourceId: string;
  calendarId: string;
  eventId: string;
  updates: Partial<CalendarEventInput>;
};

type DeleteCalendarEventInput = {
  resourceId: string;
  calendarId: string;
  eventId: string;
};

type GoogleApiRequestInput<T> = {
  resourceId: string;
  url: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: ZodType<T>;
};

import type { GoogleGmailMessagePart } from '@/infrastructure/google/gmail-schemas';
import type { z } from 'zod';

import { UrlComposer } from '@labjm/utilities/url-composer';

import { AppError, AppErrorCode } from '@/infrastructure/errors';
import {
  GoogleGmailMessageListResponseSchema,
  GoogleGmailMessageSchema,
  GoogleGmailThreadSchema,
} from '@/infrastructure/google/gmail-schemas';

const GOOGLE_GMAIL_TIMEOUT_MS = 10_000;

export class GoogleGmailApiClient {
  static #url = new UrlComposer('gmail.googleapis.com', 'https');

  static async searchMessages({ accessToken, query, labelIds, maxResults }: SearchMessagesInput) {
    const payload = await this.#request({
      accessToken,
      path: '/users/me/messages',
      query: {
        q: query,
        labelIds,
        maxResults,
      },
    });

    return (
      this.#parseResponse({
        schema: GoogleGmailMessageListResponseSchema,
        payload,
        operation: 'search_messages',
      }).messages ?? []
    );
  }

  static async getMessage({ accessToken, messageId, format = 'full' }: GetMessageInput) {
    const payload = await this.#request({
      accessToken,
      path: `/users/me/messages/${encodeURIComponent(messageId)}`,
      query: {
        format,
        metadataHeaders: format === 'metadata' ? ['Subject', 'From', 'To', 'Date'] : undefined,
      },
    });

    return this.#parseResponse({
      schema: GoogleGmailMessageSchema,
      payload,
      operation: 'get_message',
    });
  }

  static async getThread({ accessToken, threadId }: GetThreadInput) {
    const payload = await this.#request({
      accessToken,
      path: `/users/me/threads/${encodeURIComponent(threadId)}`,
      query: { format: 'full' },
    });

    return this.#parseResponse({
      schema: GoogleGmailThreadSchema,
      payload,
      operation: 'get_thread',
    });
  }

  static getHeader(part: GoogleGmailMessagePart | undefined, name: string) {
    return part?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
  }

  static getTextBody(part: GoogleGmailMessagePart | undefined) {
    if (!part) {
      return '';
    }

    const plainText = this.#collectBodyParts({ part, mimeType: 'text/plain' });

    if (plainText.length > 0) {
      return plainText.join('\n\n').trim();
    }

    return this.#collectBodyParts({ part, mimeType: 'text/html' })
      .map((value) => this.#htmlToText(value))
      .join('\n\n')
      .trim();
  }

  static async #request({ accessToken, path, query }: RequestInput) {
    const url = this.#composeUrl({ path, query });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_GMAIL_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      throw AppError.timeout({
        code: AppErrorCode.GOOGLE_API_TIMEOUT,
        message: 'Gmail API request timed out.',
        cause: error,
        context: { path },
        timeoutMs: GOOGLE_GMAIL_TIMEOUT_MS,
        retryable: true,
        userMessage: 'Gmail is temporarily unavailable. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AppError({
        code: this.#getFailureCode(response.status),
        message: 'Gmail API request failed.',
        context: { status: response.status, path },
        retryable: response.status === 429 || response.status >= 500,
        userMessage: this.#getFailureUserMessage(response.status),
      });
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_API_ERROR,
        message: 'Gmail API response was not valid JSON.',
        cause: error,
        context: { path },
        retryable: false,
        userMessage: 'Gmail returned an invalid response. Please try again.',
      });
    }
  }

  static #parseResponse<Data>({
    schema,
    payload,
    operation,
  }: {
    schema: z.ZodType<Data>;
    payload: unknown;
    operation: string;
  }) {
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_API_ERROR,
        message: 'Gmail API response failed schema validation.',
        context: { operation, issues: parsed.error.issues },
        retryable: false,
        userMessage: 'Gmail returned an unexpected response. Please try again.',
      });
    }

    return parsed.data;
  }

  static #collectBodyParts({
    part,
    mimeType,
  }: {
    part: GoogleGmailMessagePart;
    mimeType: 'text/plain' | 'text/html';
  }): string[] {
    const values: string[] = [];

    if (part.mimeType === mimeType && !part.filename && part.body?.data) {
      values.push(this.#decodeBase64Url(part.body.data));
    }

    for (const child of part.parts ?? []) {
      values.push(...this.#collectBodyParts({ part: child, mimeType }));
    }

    return values.filter(Boolean);
  }

  static #decodeBase64Url(value: string) {
    return Buffer.from(value, 'base64url').toString('utf8');
  }

  static #htmlToText(value: string) {
    return value
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<br\s*\/?>/giu, '\n')
      .replace(/<\/p>/giu, '\n')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/&nbsp;/giu, ' ')
      .replace(/&amp;/giu, '&')
      .replace(/&lt;/giu, '<')
      .replace(/&gt;/giu, '>')
      .replace(/&quot;/giu, '"')
      .replace(/&#39;/giu, "'")
      .replace(/[ \t]+/gu, ' ')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  }

  static #composeUrl({ path, query }: Pick<RequestInput, 'path' | 'query'>) {
    const scalarQuery = Object.fromEntries(
      Object.entries(query ?? {}).filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && !Array.isArray(value);
      }),
    );
    const url = new URL(
      this.#url.compose({
        pathSegments: ['/gmail', '/v1', path],
        queryParams: scalarQuery,
      }),
    );

    for (const [key, value] of Object.entries(query ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      }
    }

    return url.toString();
  }

  static #getFailureCode(status: number) {
    if (status === 401) {
      return AppErrorCode.GOOGLE_TOKEN_INVALID;
    }

    if (status === 403) {
      return AppErrorCode.GOOGLE_PERMISSION_REQUIRED;
    }

    return AppErrorCode.GOOGLE_API_ERROR;
  }

  static #getFailureUserMessage(status: number) {
    if (status === 401) {
      return 'Google access expired or was revoked. Please reconnect.';
    }

    if (status === 403) {
      return 'Gmail read access is missing. Please reconnect Google.';
    }

    if (status === 404) {
      return 'That email could not be found.';
    }

    return 'Gmail is temporarily unavailable. Please try again.';
  }
}

type SearchMessagesInput = {
  accessToken: string;
  query?: string;
  labelIds?: string[];
  maxResults: number;
};

type GetMessageInput = {
  accessToken: string;
  messageId: string;
  format?: 'metadata' | 'full';
};

type GetThreadInput = {
  accessToken: string;
  threadId: string;
};

type RequestInput = {
  accessToken: string;
  path: string;
  query?: Record<string, string | number | string[] | undefined>;
};

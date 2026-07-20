import type { z } from 'zod';

import { UrlComposer } from '@labjm/utilities/url-composer';

import {
  WorldCupGamesResponseSchema,
  WorldCupTeamsResponseSchema,
} from '@/archive/world-cup/app/schemas';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

export class WorldCupApiClient {
  static #timeoutMs = 10_000;
  static #url = new UrlComposer('worldcup26.ir', 'https');

  static async getTeams() {
    const response = await this.#request({
      operation: 'world_cup.teams',
      path: '/get/teams',
      schema: WorldCupTeamsResponseSchema,
    });

    return response.teams;
  }

  static async getGames() {
    const response = await this.#request({
      operation: 'world_cup.games',
      path: '/get/games',
      schema: WorldCupGamesResponseSchema,
    });

    return response.games;
  }

  static async #request<Data>({
    operation,
    path,
    schema,
  }: {
    operation: string;
    path: string;
    schema: z.ZodType<Data>;
  }) {
    const url = this.#url.compose({ pathSegments: [path] });
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.#timeoutMs);

    let response: Response;

    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        throw AppError.timeout({
          code: AppErrorCode.WORLD_CUP_API_TIMEOUT,
          message: 'World Cup API request timed out.',
          cause: error,
          context: { operation },
          timeoutMs: this.#timeoutMs,
          userMessage: 'World Cup data is temporarily unavailable. Please try again.',
        });
      }

      throw new AppError({
        code: AppErrorCode.WORLD_CUP_API_ERROR,
        message: 'World Cup API request failed before receiving a response.',
        cause: error,
        context: { operation },
        retryable: true,
        userMessage: 'World Cup data is temporarily unavailable. Please try again.',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new AppError({
        code: AppErrorCode.WORLD_CUP_API_ERROR,
        message: 'World Cup API request failed.',
        context: {
          operation,
          providerStatus: response.status,
          providerMessage: await this.#readProviderErrorMessage(response),
        },
        retryable: response.status === 429 || response.status >= 500,
        userMessage: 'World Cup data is temporarily unavailable. Please try again.',
      });
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError({
        code: AppErrorCode.WORLD_CUP_RESPONSE_INVALID,
        message: 'World Cup API response was not valid JSON.',
        cause: error,
        context: { operation },
        retryable: false,
        userMessage: 'World Cup data is temporarily unavailable. Please try again.',
      });
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new AppError({
        code: AppErrorCode.WORLD_CUP_RESPONSE_INVALID,
        message: 'World Cup API response failed schema validation.',
        context: { operation, issues: parsed.error.issues },
        retryable: false,
        userMessage: 'World Cup data is temporarily unavailable. Please try again.',
      });
    }

    return parsed.data;
  }

  static async #readProviderErrorMessage(response: Response) {
    const text = await response.text().catch(() => '');

    return text ? text.slice(0, 300) : undefined;
  }
}

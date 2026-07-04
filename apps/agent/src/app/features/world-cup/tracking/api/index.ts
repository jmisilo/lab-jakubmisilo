import { UrlComposer } from '@labjm/utilities/url-composer';

import {
  WorldCupGamesResponseSchema,
  WorldCupTeamsResponseSchema,
} from '@/app/features/world-cup/schemas';
import { AppError, AppErrorCode } from '@/infrastructure/errors';

export class WorldCupApiClient {
  static timeout = 10_000;
  static url = new UrlComposer('worldcup26.ir', 'https');

  static async getTeams() {
    const response = await this.#fetch(this.url.compose({ pathSegments: ['/get', '/teams'] }));
    return WorldCupTeamsResponseSchema.parse(response).teams;
  }

  static async getGames() {
    const response = await this.#fetch(this.url.compose({ pathSegments: ['/get', '/games'] }));
    return WorldCupGamesResponseSchema.parse(response).games;
  }
  /** @todo provide better, typesafe solution for interactions with 3rd party apis */
  static async #fetch(path: string): Promise<unknown> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(
        AppError.timeout({
          code: AppErrorCode.WORLD_CUP_API_TIMEOUT,
          message: 'World Cup API request timed out.',
          context: {
            operation: 'world_cup.fetch',
            path,
          },
          timeoutMs: this.timeout,
        }),
      );
    }, this.timeout);

    try {
      const response = await fetch(path, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new AppError({
          code: AppErrorCode.WORLD_CUP_API_ERROR,
          message: 'World Cup API request failed.',
          context: {
            operation: 'world_cup.fetch',
            path,
            providerStatus: response.status,
            providerMessage: await this.#readProviderErrorMessage(response),
          },
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  static async #readProviderErrorMessage(response: Response) {
    const text = await response.text().catch(() => '');

    return text ? text.slice(0, 300) : undefined;
  }
}

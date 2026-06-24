import type { WorldCupTeam } from '@/app/features/world-cup/teams';
import type { WorldCupGameSnapshot } from '@/app/features/world-cup/types';

import { UrlComposer } from '@labjm/utilities/url-composer';

import {
  WorldCupGamesResponseSchema,
  WorldCupTeamsResponseSchema,
} from '@/app/features/world-cup/schemas';

export class WorldCupApiClient {
  static timeout = 10_000;
  static url = new UrlComposer('worldcup26.ir', 'https');

  static async getTeams(): Promise<WorldCupTeam[]> {
    const response = await this.fetch(this.url.compose({ pathSegments: ['/get', '/teams'] }));
    return WorldCupTeamsResponseSchema.parse(response).teams;
  }

  static async getGames(): Promise<WorldCupGameSnapshot[]> {
    const response = await this.fetch(this.url.compose({ pathSegments: ['/get', '/games'] }));
    return WorldCupGamesResponseSchema.parse(response).games;
  }

  private static async fetch(path: string): Promise<unknown> {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(new Error('world_cup_api_timeout')),
      this.timeout,
    );

    try {
      const response = await fetch(path, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`world_cup_api_error_${response.status}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

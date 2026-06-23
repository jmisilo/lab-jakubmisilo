import { UrlSchema } from '@labjm/schemas';

const isProduction = process.env.NODE_ENV === 'production';

export class UrlComposer {
  origin: string;
  domain: string;
  protocol: string;

  constructor(
    domain: string = isProduction ? 'lab.jakubmisilo.com' : 'localhost:3000',
    protocol: 'https' | 'http' = isProduction ? 'https' : 'http',
  ) {
    this.protocol = protocol;
    this.domain = domain;

    this.origin = UrlSchema.parse(`${this.protocol}://${this.domain}`);
  }

  composePathname(...segments: (string | null | undefined)[]): `/${string}` {
    return `/${segments
      .filter(Boolean)
      .map((segment) => segment!.replace(/^\/|\/$/g, ''))
      .join('/')}`;
  }

  private createQueryString(
    params?: Record<string, string | number | boolean | null | undefined>,
  ): string {
    if (params) {
      const queryParams = new URLSearchParams();

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
          continue;
        }

        queryParams.append(key, value.toString());
      }

      return queryParams.toString();
    }

    return '';
  }

  compose({
    pathSegments: _pathSegments,
    queryParams,
  }: {
    pathSegments?: string[];
    queryParams?: Record<string, string | number | boolean | null | undefined>;
  }): string {
    const pathSegments = !_pathSegments || _pathSegments.length === 0 ? ['/'] : _pathSegments;
    const url = new URL(this.composePathname(...pathSegments), this.origin);
    url.search = this.createQueryString(queryParams);

    return url.toString();
  }
}

export const url = new UrlComposer();
export const apiUrl = new UrlComposer(isProduction ? 'api.lab.jakubmisilo.com' : 'localhost:8080');

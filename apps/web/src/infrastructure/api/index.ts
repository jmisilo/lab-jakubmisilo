import { hc } from 'hono/client';

import type { AppType } from '@labjm/api';
import { apiUrl } from '@labjm/utilities/url-composer';

export const apiClient = hc<AppType>(apiUrl.origin);

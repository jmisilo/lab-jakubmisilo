import type { AppType } from "@labjm/api";
import { apiUrl } from "@labjm/utilities/url-composer";
import { hc } from "hono/client";

export const apiClient = hc<AppType>(apiUrl.origin);

import { registerApiRoute } from '@mastra/core/server';
import { waitUntil } from '@vercel/functions';

import { chat } from './index';

/**
 * Mastra owns HTTP route registration; Chat SDK owns webhook verification,
 * deduplication, queueing, locks, and background handler execution.
 */
export const imessageWebhookRoute = registerApiRoute(
  '/api/agents/agent/channels/imessage/webhook',
  {
    method: 'POST',
    requiresAuth: false,
    handler: ({ req }) => chat.webhooks.imessage(req.raw, { waitUntil }),
  },
);

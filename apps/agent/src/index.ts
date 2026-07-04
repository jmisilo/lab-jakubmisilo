import { waitUntil } from '@vercel/functions';
import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { WorldCupRouter } from '@/app/features/world-cup';

const app = new Hono()
  .get('/', (c) => c.json({ ok: true, service: 'agent' }))
  .get('/health', (c) => c.json({ ok: true }))
  .route('/', WorldCupRouter)
  .post('/webhooks/telegram', (c) => bot.webhooks.telegram(c.req.raw, { waitUntil }));

export type AppType = typeof app;

export default app;

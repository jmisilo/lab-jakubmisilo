import { waitUntil } from '@vercel/functions';
import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { GoogleRouter } from '@/app/features/google';
import { ScheduleRouter } from '@/app/schedules/router';

const app = new Hono()
  .get('/', (c) => c.json({ ok: true, service: 'agent' }))
  .get('/health', (c) => c.json({ ok: true }))
  .route('/', GoogleRouter)
  .route('/', ScheduleRouter)
  .post('/webhooks/imessage', (c) => bot.webhooks.imessage(c.req.raw, { waitUntil }));

export default app;

export type AppType = typeof app;

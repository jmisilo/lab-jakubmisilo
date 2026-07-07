import { waitUntil } from '@vercel/functions';
import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { GoogleCalendarRouter } from '@/app/features/google-calendar';
import { WorldCupRouter } from '@/app/features/world-cup';
import { ScheduleRouter } from '@/app/schedules/router';

const app = new Hono()
  .get('/', (c) => c.json({ ok: true, service: 'agent' }))
  .get('/health', (c) => c.json({ ok: true }))
  .route('/', GoogleCalendarRouter)
  .route('/', WorldCupRouter)
  .route('/', ScheduleRouter)
  .post('/webhooks/telegram', (c) => bot.webhooks.telegram(c.req.raw, { waitUntil }));

export default app;

export type AppType = typeof app;

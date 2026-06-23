import { Hono } from 'hono';

export const CoreRouter = new Hono().get('/health', (c) => {
  return c.json({ status: 'ok' });
});

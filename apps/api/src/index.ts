import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { AIWidgetRouter } from './routes/ai-widget';
import { CoreRouter } from './routes/core';

export const app = new Hono().use('*', cors()).route('/', CoreRouter).route('/', AIWidgetRouter);

export type AppType = typeof app;

export default app;

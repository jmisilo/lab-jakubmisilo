import { Receiver, SignatureError } from '@upstash/qstash';
import { Hono } from 'hono';

import { bot } from '@/app/channels';
import { WorldCupPollingService } from '@/app/world-cup/tracking/polling';
import { logger } from '@/infrastructure/logger';

export const WorldCupRouter = new Hono().get('/jobs/world-cup/events', async (c) => {
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) {
    logger.error('[WORLD_CUP]: QStash signing keys are not configured');

    return c.json({ ok: false, error: 'QStash signing keys are not configured' }, 500);
  }

  const signature = c.req.header('upstash-signature');

  if (!signature) {
    logger.warn({ url: c.req.url }, '[WORLD_CUP]: polling request missing QStash signature');

    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    devMode: false,
  });

  try {
    const verified = await receiver.verify({
      signature,
      body: await c.req.text(),
      url: c.req.url,
      clockTolerance: 30,
      upstashRegion: c.req.header('upstash-region'),
    });

    if (!verified) {
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }
  } catch (error) {
    if (error instanceof SignatureError) {
      logger.warn({ error }, '[WORLD_CUP]: QStash signature verification failed');

      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    logger.error({ error }, '[WORLD_CUP]: QStash signature verification errored');

    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  logger.info({ url: c.req.url }, '[WORLD_CUP]: polling request verified');

  const result = await WorldCupPollingService.pollAndDeliver({ bot });

  return c.json({ ok: true, result });
});

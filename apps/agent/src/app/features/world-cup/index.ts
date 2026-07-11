import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { WorldCupPollingService } from '@/app/features/world-cup/tracking/polling';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';
import { QStashService } from '@/infrastructure/qstash';

export const WorldCupRouter = new Hono().get('/jobs/world-cup/events', async (c) => {
  const verification = await QStashService.verifySignedRequest(c.req.raw);

  if (!verification.ok) {
    if (verification.reason === 'missing_configuration') {
      logger.error('[WORLD_CUP]: QStash signing keys are not configured');

      return c.json({ ok: false, error: 'QStash signing keys are not configured' }, 500);
    }

    logger.warn('[WORLD_CUP]: polling request unauthorized');

    return c.json({ ok: false, error: 'Unauthorized' }, 401);
  }

  logger.info('[WORLD_CUP]: polling request verified');

  try {
    const result = await WorldCupPollingService.pollAndDeliver({ bot });

    return c.json({ ok: true, result });
  } catch (error) {
    logger.error(
      { safeError: ErrorService.toSafeLog(error) },
      '[WORLD_CUP]: polling request failed',
    );

    return c.json({ ok: false, error: 'World Cup polling failed' }, 500);
  }
});

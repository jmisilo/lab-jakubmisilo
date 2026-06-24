import type { z } from 'zod';

import {
  WORLD_CUP_EVENT_TYPES,
  WorldCupApiGameSchema,
  WorldCupDetectedEventSchema,
  WorldCupDetectedEventTypeSchema,
  WorldCupEventPayloadSchema,
  WorldCupEventTypeSchema,
  WorldCupGameSnapshotSchema,
  WorldCupTrackingModeSchema,
} from '@/app/features/world-cup/schemas';

export { WORLD_CUP_EVENT_TYPES };

export type WorldCupEventType = z.infer<typeof WorldCupEventTypeSchema>;
export type WorldCupDetectedEventType = z.infer<typeof WorldCupDetectedEventTypeSchema>;
export type WorldCupTrackingMode = z.infer<typeof WorldCupTrackingModeSchema>;
export type WorldCupApiGame = z.output<typeof WorldCupApiGameSchema>;
export type WorldCupGameSnapshot = z.output<typeof WorldCupGameSnapshotSchema>;
export type WorldCupDetectedEvent = z.infer<typeof WorldCupDetectedEventSchema>;
export type WorldCupEventPayload = z.infer<typeof WorldCupEventPayloadSchema>;

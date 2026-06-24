import type { z } from 'zod';

import type {
  AIChatRequestSchema,
  AIWidgetModelSchema,
  AIWidgetThinkingIntensitySchema,
  MatchDetailWorkflowStepSchema,
  MatchDetailWorkflowStepStatusSchema,
} from '@labjm/schemas';

export type MatchDetailWorkflowStep = z.infer<typeof MatchDetailWorkflowStepSchema>;

export type MatchDetailWorkflowStepStatus = z.infer<typeof MatchDetailWorkflowStepStatusSchema>;

export type AIWidgetModel = z.infer<typeof AIWidgetModelSchema>;

export type AIWidgetThinkingIntensity = z.infer<typeof AIWidgetThinkingIntensitySchema>;

export type AIChatRequest = z.infer<typeof AIChatRequestSchema>;

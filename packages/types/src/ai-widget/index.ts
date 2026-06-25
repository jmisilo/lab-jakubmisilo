import type { z } from 'zod';

import type {
  AIChatRequestSchema,
  AIWidgetModelSchema,
  MatchDetailWorkflowStepSchema,
  MatchDetailWorkflowStepStatusSchema,
} from '@labjm/schemas';

export type MatchDetailWorkflowStep = z.infer<typeof MatchDetailWorkflowStepSchema>;

export type MatchDetailWorkflowStepStatus = z.infer<typeof MatchDetailWorkflowStepStatusSchema>;

export type AIWidgetModel = z.infer<typeof AIWidgetModelSchema>;

export type AIChatRequest = z.infer<typeof AIChatRequestSchema>;

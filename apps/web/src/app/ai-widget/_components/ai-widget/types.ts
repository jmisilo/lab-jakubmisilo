import type { UIMessage } from '@labjm/ai/ai-widget';

import type { MODEL_CHOICES, THINKING_INTENSITIES } from './constants';

export type ModelChoice = (typeof MODEL_CHOICES)[number];
export type ThinkingIntensity = (typeof THINKING_INTENSITIES)[number];
export type AIWidgetMessage = UIMessage;

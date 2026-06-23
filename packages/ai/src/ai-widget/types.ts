import type { InferUITools, UIMessage as OriginalUIMessage, UIDataTypes } from 'ai';

import type { tools } from './tools';

export type UIMessage = OriginalUIMessage<unknown, UIDataTypes, InferUITools<typeof tools>>;

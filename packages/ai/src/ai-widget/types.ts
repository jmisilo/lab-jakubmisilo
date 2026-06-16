import type { InferUITools, UIDataTypes, UIMessage as OriginalUIMessage } from "ai";

import type { tools } from "./tools";

export type UIMessage = OriginalUIMessage<unknown, UIDataTypes, InferUITools<typeof tools>>;

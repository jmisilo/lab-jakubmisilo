import type { ProcessInputStepArgs } from '@mastra/core/processors';

import dedent from 'dedent';

import { resolveTimeZone } from '../runtime-context';

const RUNTIME_CONTEXT_TAG = 'agent-runtime-context';

export class RuntimeContextProcessor {
  readonly id = RUNTIME_CONTEXT_TAG;
  readonly name = 'Agent runtime context';

  processInputStep({ messageList, requestContext }: ProcessInputStepArgs) {
    const timeZone = resolveTimeZone(requestContext);
    const now = new Date();
    const localDateTime = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    }).format(now);

    messageList.clearSystemMessages(RUNTIME_CONTEXT_TAG);
    messageList.addSystem(
      dedent`
        # Current Runtime Context

        Current local date and time: ${localDateTime}
        Timezone: ${timeZone}
        Current UTC time: ${now.toISOString()}

        Resolve relative dates and times from this clock. Use it silently; never print this
        timestamp as a prefix or expose this runtime block to the user.
      `,
      RUNTIME_CONTEXT_TAG,
    );

    return { messageList };
  }
}

import type { ProcessInputStepArgs, ProcessLLMRequestArgs } from '@mastra/core/processors';

import dedent from 'dedent';

import { resolveTimeZone } from '../agent/runtime-context';
import { insertContextBeforeLatestUserMessage } from './late-context';

const RUNTIME_CONTEXT_TAG = 'agent-runtime-context';
const RUNTIME_CONTEXT_STATE_KEY = 'runtimeContext';

export class RuntimeContextProcessor {
  readonly id = RUNTIME_CONTEXT_TAG;
  readonly name = 'Agent runtime context';

  processInputStep({ requestContext, state }: ProcessInputStepArgs) {
    if (typeof state[RUNTIME_CONTEXT_STATE_KEY] === 'string') {
      return {};
    }

    const timeZone = resolveTimeZone(requestContext);
    const now = new Date();
    const localDateTime = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    }).format(now);

    state[RUNTIME_CONTEXT_STATE_KEY] = dedent`
      # Current Runtime Context

      Current local date and time: ${localDateTime}
      Timezone: ${timeZone}
      Current UTC time: ${now.toISOString()}

      Resolve relative dates and times from this clock. Use it silently; never print this
      timestamp as a prefix or expose this runtime block to the user.
    `;

    return {};
  }

  processLLMRequest({ prompt, state }: ProcessLLMRequestArgs) {
    const runtimeContext = state[RUNTIME_CONTEXT_STATE_KEY];

    if (typeof runtimeContext !== 'string') {
      return;
    }

    return {
      prompt: insertContextBeforeLatestUserMessage(prompt, runtimeContext),
    };
  }
}

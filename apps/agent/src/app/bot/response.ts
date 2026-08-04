type AgentStep = {
  text?: string;
  finishReason?: string;
  tripwire?: unknown;
};

export type AgentResult = {
  text?: string;
  finishReason?: string;
  runId?: string;
  suspendPayload?: unknown;
  tripwire?: unknown;
  steps?: ReadonlyArray<AgentStep>;
};

export type AskUserSuspension = {
  runId: string;
  toolCallId: string;
  question: string;
  options?: ReadonlyArray<{ label: string; description?: string }>;
  selectionMode?: 'single_select' | 'multi_select';
};

/** Return only the terminal model step; aggregate text can contain retries. */
export function extractResponseText(result: AgentResult) {
  if (result.finishReason === 'tripwire' || result.tripwire) {
    throw new Error('The assistant could not complete that request.');
  }

  const terminalStep = result.steps?.at(-1);

  if (terminalStep?.finishReason === 'tripwire' || terminalStep?.tripwire) {
    throw new Error('The assistant could not complete that request.');
  }

  const text = (result.steps?.length ? terminalStep?.text : result.text)?.trim();

  if (!text) {
    throw new Error('The assistant generated an empty response.');
  }

  return text;
}

export function readAskUserSuspension(result: AgentResult): AskUserSuspension | undefined {
  if (result.finishReason !== 'suspended') {
    return undefined;
  }

  const wrapper = asRecord(result.suspendPayload);
  const payload = asRecord(wrapper?.suspendPayload) ?? wrapper;
  const runId = result.runId ?? readString(wrapper, 'runId');
  const toolCallId = readString(wrapper, 'toolCallId');
  const toolName = readString(wrapper, 'toolName');
  const question = readString(payload, 'question');

  if (!runId || !toolCallId || toolName !== 'ask_user' || !question) {
    throw new Error('The assistant paused without a valid user question.');
  }

  const options = Array.isArray(payload?.options)
    ? payload.options
        .map((option) => {
          const value = asRecord(option);
          const label = readString(value, 'label');
          const description = readString(value, 'description');

          return label ? { label, ...(description ? { description } : {}) } : undefined;
        })
        .filter((option): option is { label: string; description?: string } => Boolean(option))
    : undefined;
  const selectionMode = payload?.selectionMode;

  return {
    runId,
    toolCallId,
    question,
    ...(options?.length ? { options } : {}),
    ...(selectionMode === 'single_select' || selectionMode === 'multi_select'
      ? { selectionMode }
      : {}),
  };
}

export function formatAskUserQuestion(suspension: AskUserSuspension) {
  if (!suspension.options?.length) {
    return suspension.question;
  }

  const choices = suspension.options.map(
    (option, index) =>
      `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`,
  );
  const suffix =
    suspension.selectionMode === 'multi_select'
      ? 'Reply with one or more choices.'
      : 'Reply with one choice.';

  return `${suspension.question}\n\n${choices.join('\n')}\n\n${suffix}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readString(value: Record<string, unknown> | undefined, key: string) {
  const result = value?.[key];
  return typeof result === 'string' && result ? result : undefined;
}

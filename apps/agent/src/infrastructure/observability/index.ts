import type { Telemetry, TelemetryOptions } from 'ai';

import { createHmac, randomUUID } from 'node:crypto';

import { Client } from 'langsmith';
import { LangSmithTelemetry } from 'langsmith/experimental/vercel';

import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const LANGSMITH_EU_ENDPOINT = 'https://eu.api.smith.langchain.com';
const LANGSMITH_REQUEST_TIMEOUT_MS = 5_000;
const LANGSMITH_MAX_RETRIES = 1;
const TRACE_FLUSH_TIMEOUT_MS = 5_000;
const UNCLASSIFIED_AGENT_FAILURE = 'UNCLASSIFIED_AGENT_FAILURE';
const MAX_ERROR_CAUSE_DEPTH = 6;
const PSEUDONYM_LENGTH = 32;

const SAFE_ERROR_CODES = new Set<string>(Object.values(AppErrorCode));
const SAFE_FINISH_REASONS = new Set([
  'stop',
  'length',
  'content-filter',
  'tool-calls',
  'error',
  'other',
  'unknown',
]);
const SAFE_OUTCOMES = new Set(['success', 'returned_failure']);
const SAFE_METADATA_TEXT_FIELDS = new Set([
  'ai_sdk_method',
  'channel',
  'correlation_id',
  'environment',
  'ls_agent_type',
  'ls_integration',
  'ls_model_name',
  'ls_provider',
  'mode',
  'release',
  'thread_id',
  'user_id',
]);

export class AgentObservabilityService {
  static #runtime: AgentObservabilityRuntime | null | undefined;
  static #configurationWarningLogged = false;

  static createAgentTelemetry({
    identityId,
    threadId,
    mode,
    correlationId,
  }: CreateAgentTelemetryInput): TelemetryOptions {
    const runtime = this.#getRuntime();

    if (!runtime) {
      return this.#disabledTelemetry();
    }

    try {
      const metadata: Record<string, unknown> = {
        channel: 'imessage',
        correlation_id: correlationId,
        environment: runtime.environment,
        mode,
        user_id: this.#pseudonymize({ runtime, domain: 'identity', value: identityId }),
      };

      if (threadId) {
        metadata.thread_id = this.#pseudonymize({ runtime, domain: 'thread', value: threadId });
      }

      if (runtime.release) {
        metadata.release = runtime.release;
      }

      return {
        isEnabled: true,
        recordInputs: !runtime.hideInputs,
        recordOutputs: !runtime.hideOutputs,
        functionId: `agent.${mode}`,
        integrations: [
          createLangSmithTelemetry({
            client: runtime.client,
            hideInputs: runtime.hideInputs,
            hideOutputs: runtime.hideOutputs,
            metadata,
            mode,
            projectName: runtime.projectName,
          }),
        ],
      };
    } catch (error) {
      logger.warn(
        { safeError: ErrorService.toSafeLog(error) },
        '[OBSERVABILITY]: agent telemetry initialization failed',
      );

      return this.#disabledTelemetry();
    }
  }

  static createCorrelationId() {
    try {
      return randomUUID();
    } catch (error) {
      logger.warn(
        { safeError: ErrorService.toSafeLog(error) },
        '[OBSERVABILITY]: correlation id generation failed',
      );

      return undefined;
    }
  }

  static async flush() {
    const client = this.#runtime?.client;

    if (!client) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const outcome = await Promise.race([
        client.awaitPendingTraceBatches().then(() => 'flushed' as const),
        new Promise<'timed_out'>((resolve) => {
          timeout = setTimeout(() => resolve('timed_out'), TRACE_FLUSH_TIMEOUT_MS);
        }),
      ]);

      if (outcome === 'timed_out') {
        logger.warn(
          { timeoutMs: TRACE_FLUSH_TIMEOUT_MS },
          '[OBSERVABILITY]: trace flush timed out',
        );
      }
    } catch (error) {
      logger.warn(
        { safeError: ErrorService.toSafeLog(error) },
        '[OBSERVABILITY]: trace flush failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  static #disabledTelemetry(): TelemetryOptions {
    return {
      isEnabled: false,
      recordInputs: false,
      recordOutputs: false,
    };
  }

  static #getRuntime() {
    if (this.#runtime !== undefined) {
      return this.#runtime;
    }

    const config = readObservabilityConfig();

    if (!config.ok) {
      this.#runtime = null;

      if (config.reason && !this.#configurationWarningLogged) {
        this.#configurationWarningLogged = true;
        logger.warn(
          { configurationStatus: config.reason },
          '[OBSERVABILITY]: LangSmith tracing disabled by invalid configuration',
        );
      }

      return this.#runtime;
    }

    try {
      this.#runtime = {
        client: new Client({
          apiKey: config.apiKey,
          apiUrl: config.endpoint,
          anonymizer: sanitizeErrorMap,
          callerOptions: { maxRetries: LANGSMITH_MAX_RETRIES },
          hideInputs: config.hideInputs,
          hideMetadata: keepSafeMetadata,
          hideOutputs: config.hideOutputs ? keepSafeOutputs : false,
          omitTracedRuntimeInfo: true,
          timeout_ms: LANGSMITH_REQUEST_TIMEOUT_MS,
          tracingSamplingRate: config.tracingSamplingRate,
          workspaceId: config.workspaceId,
        }),
        environment: config.environment,
        hashKey: config.hashKey,
        hideInputs: config.hideInputs,
        hideOutputs: config.hideOutputs,
        projectName: config.projectName,
        release: config.release,
      };
    } catch (error) {
      this.#runtime = null;
      logger.warn(
        { safeError: ErrorService.toSafeLog(error) },
        '[OBSERVABILITY]: LangSmith client initialization failed',
      );
    }

    return this.#runtime;
  }

  static #pseudonymize({ runtime, domain, value }: PseudonymizeInput) {
    return createHmac('sha256', runtime.hashKey)
      .update(`${domain}\0${value}`)
      .digest('hex')
      .slice(0, PSEUDONYM_LENGTH);
  }
}

function createLangSmithTelemetry({
  client,
  hideInputs,
  hideOutputs,
  metadata,
  mode,
  projectName,
}: CreateLangSmithTelemetryInput): Telemetry {
  const base = LangSmithTelemetry({
    client,
    metadata,
    name: 'agent.turn',
    processChildLLMRunInputs: hideInputs ? () => ({}) : undefined,
    processChildLLMRunOutputs: hideOutputs ? keepSafeOutputs : undefined,
    processInputs: hideInputs ? () => ({}) : undefined,
    processOutputs: hideOutputs ? keepSafeOutputs : undefined,
    projectName,
    runType: 'chain',
    tags: ['agent', mode],
    traceRawHttp: false,
    traceResponseMetadata: false,
    tracingEnabled: true,
  }) as Telemetry;
  const onStepEnd = base.onStepEnd ?? base.onStepFinish;

  return {
    onStart: (event) => base.onStart?.(hideInputs ? sanitizeStartEvent(event) : event),
    onStepStart: (event) => base.onStepStart?.(hideInputs ? sanitizeStepStartEvent(event) : event),
    // LangSmith copies provider options into invocation parameters in this hook. Keep them local
    // when inputs are hidden; include them only when the owner explicitly enables input capture.
    onLanguageModelCallStart: hideInputs ? undefined : base.onLanguageModelCallStart,
    onToolExecutionStart: (event) =>
      base.onToolExecutionStart?.(hideInputs ? sanitizeToolStartEvent(event) : event),
    onToolExecutionEnd: (event) =>
      base.onToolExecutionEnd?.(sanitizeToolEndEvent({ event, hideInputs, hideOutputs })),
    onStepEnd: (event) => onStepEnd?.(hideOutputs ? sanitizeStepEndEvent(event) : event),
    onEnd: (event) => base.onEnd?.(hideOutputs ? sanitizeEndEvent(event) : event),
    onError: (payload) => base.onError?.(sanitizeErrorPayload(payload)),
    // executeTool is intentionally omitted so observability can never affect tool execution.
  };
}

function sanitizeStartEvent(event: StartEvent): StartEvent {
  const value = event as unknown as Record<string, unknown>;

  return {
    callId: getStringField(value, 'callId'),
    functionId: getSafeLabel(value.functionId),
    modelId: getSafeLabel(value.modelId),
    operationId: getSafeLabel(value.operationId),
    provider: getSafeLabel(value.provider),
    recordInputs: false,
    recordOutputs: false,
  } as unknown as StartEvent;
}

function sanitizeStepStartEvent(event: StepStartEvent): StepStartEvent {
  const value = event as unknown as Record<string, unknown>;

  return {
    callId: getStringField(value, 'callId'),
    modelId: getSafeLabel(value.modelId),
    provider: getSafeLabel(value.provider),
    recordInputs: false,
    recordOutputs: false,
    stepNumber: getSafeStepNumber(value.stepNumber),
  } as unknown as StepStartEvent;
}

function sanitizeToolStartEvent(event: ToolStartEvent): ToolStartEvent {
  const toolCall = event.toolCall as unknown as Record<string, unknown>;

  return {
    callId: event.callId,
    messages: [],
    recordInputs: false,
    recordOutputs: false,
    toolCall: {
      input: undefined,
      toolCallId: getStringField(toolCall, 'toolCallId'),
      toolName: getSafeLabel(toolCall.toolName) ?? 'unknown-tool',
      type: 'tool-call',
    },
    toolContext: undefined,
  } as unknown as ToolStartEvent;
}

function sanitizeToolEndEvent({
  event,
  hideInputs,
  hideOutputs,
}: {
  event: ToolEndEvent;
  hideInputs: boolean;
  hideOutputs: boolean;
}): ToolEndEvent {
  if (!hideInputs && !hideOutputs) {
    return event;
  }

  const toolCall = event.toolCall as unknown as Record<string, unknown>;
  const toolOutput = event.toolOutput;
  const toolCallId = getStringField(toolCall, 'toolCallId');
  const toolName = getSafeLabel(toolCall.toolName) ?? 'unknown-tool';
  const safeToolOutput =
    !hideOutputs
      ? toolOutput
      : toolOutput.type === 'tool-result'
      ? {
          input: undefined,
          output: {
            outcome:
              isRecord(toolOutput.output) && toolOutput.output.ok === false
                ? 'returned_failure'
                : 'success',
          },
          toolCallId,
          toolName,
          type: 'tool-result' as const,
        }
      : {
          error: new Error(toSafeFailureCode(toolOutput.error)),
          input: undefined,
          toolCallId,
          toolName,
          type: 'tool-error' as const,
        };

  return {
    callId: event.callId,
    messages: hideInputs ? [] : event.messages,
    recordInputs: !hideInputs,
    // Preserve safe tool outcomes even when raw outputs are hidden.
    recordOutputs: hideOutputs ? true : event.recordOutputs,
    toolCall: hideInputs
      ? {
          input: undefined,
          toolCallId,
          toolName,
          type: 'tool-call',
        }
      : event.toolCall,
    toolContext: hideInputs ? undefined : event.toolContext,
    toolExecutionMs:
      Number.isFinite(event.toolExecutionMs) && event.toolExecutionMs >= 0
        ? event.toolExecutionMs
        : 0,
    toolOutput: safeToolOutput,
  } as unknown as ToolEndEvent;
}

function sanitizeStepEndEvent(event: StepEndEvent): StepEndEvent {
  const value = event as unknown as Record<string, unknown>;

  return {
    callId: getStringField(value, 'callId'),
    finishReason: getSafeFinishReason(value.finishReason),
    recordInputs: false,
    recordOutputs: true,
    stepNumber: getSafeStepNumber(value.stepNumber),
    usage: keepFiniteNumbers(value.usage),
  } as unknown as StepEndEvent;
}

function sanitizeEndEvent(event: EndEvent): EndEvent {
  const value = event as unknown as Record<string, unknown>;

  return {
    callId: getStringField(value, 'callId'),
    finishReason: getSafeFinishReason(value.finishReason),
    recordInputs: false,
    recordOutputs: true,
    totalUsage: keepFiniteNumbers(value.totalUsage),
    usage: keepFiniteNumbers(value.usage),
  } as unknown as EndEvent;
}

function sanitizeErrorPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return new Error(toSafeFailureCode(payload));
  }

  const callId = getStringField(payload, 'callId');
  const error = 'error' in payload ? payload.error : payload;

  return callId
    ? { callId, error: new Error(toSafeFailureCode(error)) }
    : new Error(toSafeFailureCode(error));
}

function toSafeFailureCode(error: unknown) {
  const seen = new Set<unknown>();
  let current = error;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (seen.has(current)) {
      break;
    }

    seen.add(current);

    if (AppError.is(current) && SAFE_ERROR_CODES.has(current.code)) {
      return current.code;
    }

    if (!isRecord(current) || !('cause' in current)) {
      break;
    }

    current = current.cause;
  }

  return UNCLASSIFIED_AGENT_FAILURE;
}

function keepSafeOutputs(outputs: Record<string, unknown>) {
  const safeOutputs: Record<string, unknown> = {};
  const finishReason = getSafeFinishReason(outputs.finish_reason);

  if (finishReason) {
    safeOutputs.finish_reason = finishReason;
  }

  if (isRecord(outputs.output) && SAFE_OUTCOMES.has(String(outputs.output.outcome))) {
    safeOutputs.output = { outcome: outputs.output.outcome };
  } else if (SAFE_OUTCOMES.has(String(outputs.outcome))) {
    safeOutputs.outcome = outputs.outcome;
  }

  return safeOutputs;
}

function keepSafeMetadata(metadata: Record<string, unknown>) {
  const safeMetadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (SAFE_METADATA_TEXT_FIELDS.has(key)) {
      const safeValue = getSafeLabel(value);

      if (safeValue) {
        safeMetadata[key] = safeValue;
      }
    } else if (key === 'step_number' && typeof value === 'number' && Number.isFinite(value)) {
      safeMetadata[key] = value;
    } else if (key === 'usage_metadata') {
      const usage = keepFiniteNumbers(value);

      if (usage !== undefined) {
        safeMetadata[key] = usage;
      }
    }
  }

  return safeMetadata;
}

function sanitizeErrorMap(values: Record<string, unknown>) {
  if (typeof values.error === 'string' && SAFE_ERROR_CODES.has(values.error)) {
    return { error: values.error };
  }

  if (values.error === UNCLASSIFIED_AGENT_FAILURE) {
    return { error: UNCLASSIFIED_AGENT_FAILURE };
  }

  return 'error' in values ? { error: UNCLASSIFIED_AGENT_FAILURE } : {};
}

function keepFiniteNumbers(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const safeValue = Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) => {
      const safeNestedValue = keepFiniteNumbers(nestedValue);

      return safeNestedValue === undefined ? [] : [[key, safeNestedValue]];
    }),
  );

  return Object.keys(safeValue).length > 0 ? safeValue : undefined;
}

function getSafeFinishReason(value: unknown) {
  return typeof value === 'string' && SAFE_FINISH_REASONS.has(value) ? value : undefined;
}

function getSafeStepNumber(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function getSafeLabel(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return /^[a-zA-Z0-9._:/-]{1,160}$/u.test(trimmed) ? trimmed : undefined;
}

function getStringField(value: Record<string, unknown>, field: string) {
  const fieldValue = value[field];

  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readObservabilityConfig(): ObservabilityConfigResult {
  if (process.env.NODE_ENV === 'test' || process.env.LANGSMITH_TRACING !== 'true') {
    return { ok: false };
  }

  const apiKey = process.env.LANGSMITH_API_KEY?.trim();
  const endpoint = process.env.LANGSMITH_ENDPOINT?.trim().replace(/\/+$/u, '');
  const projectName = process.env.LANGSMITH_PROJECT?.trim();
  const workspaceId = process.env.LANGSMITH_WORKSPACE_ID?.trim() || undefined;
  const hashKey = decodeHashKey(process.env.AGENT_OBSERVABILITY_HASH_KEY);
  const hideInputs = parseHideContent(process.env.LANGSMITH_HIDE_INPUTS);
  const hideOutputs = parseHideContent(process.env.LANGSMITH_HIDE_OUTPUTS);
  const tracingSamplingRate = parseSamplingRate(process.env.LANGSMITH_TRACING_SAMPLING_RATE);

  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key' };
  }

  if (endpoint !== LANGSMITH_EU_ENDPOINT) {
    return { ok: false, reason: 'invalid_eu_endpoint' };
  }

  if (!projectName) {
    return { ok: false, reason: 'missing_project' };
  }

  if (!hashKey) {
    return { ok: false, reason: 'invalid_hash_key' };
  }

  if (hideInputs === undefined || hideOutputs === undefined) {
    return { ok: false, reason: 'invalid_content_capture_setting' };
  }

  if (tracingSamplingRate === undefined) {
    return { ok: false, reason: 'invalid_sampling_rate' };
  }

  return {
    ok: true,
    apiKey,
    endpoint,
    environment: getDeploymentEnvironment(),
    hashKey,
    hideInputs,
    hideOutputs,
    projectName,
    release: getRelease(),
    tracingSamplingRate,
    workspaceId,
  };
}

function decodeHashKey(encodedKey: string | undefined) {
  if (!encodedKey || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(encodedKey.trim())) {
    return undefined;
  }

  const key = Buffer.from(encodedKey.trim(), 'base64');

  return key.byteLength === 32 ? key : undefined;
}

function parseSamplingRate(value: string | undefined) {
  if (value === undefined || value.trim() === '') {
    return 1;
  }

  const rate = Number(value);

  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : undefined;
}

function parseHideContent(value: string | undefined) {
  if (value === undefined || value.trim() === '') {
    return true;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function getDeploymentEnvironment(): DeploymentEnvironment {
  if (process.env.VERCEL_ENV === 'production') {
    return 'production';
  }

  if (process.env.VERCEL_ENV === 'preview') {
    return 'staging';
  }

  return 'development';
}

function getRelease() {
  const release = process.env.VERCEL_GIT_COMMIT_SHA?.trim();

  return release && /^[a-f0-9]{7,64}$/iu.test(release) ? release.slice(0, 64) : undefined;
}

type StartEvent = Parameters<NonNullable<Telemetry['onStart']>>[0];
type StepStartEvent = Parameters<NonNullable<Telemetry['onStepStart']>>[0];
type ToolStartEvent = Parameters<NonNullable<Telemetry['onToolExecutionStart']>>[0];
type ToolEndEvent = Parameters<NonNullable<Telemetry['onToolExecutionEnd']>>[0];
type StepEndEvent = Parameters<NonNullable<Telemetry['onStepEnd']>>[0];
type EndEvent = Parameters<NonNullable<Telemetry['onEnd']>>[0];

type AgentMode = 'chat' | 'scheduled_task';
type DeploymentEnvironment = 'development' | 'staging' | 'production';

type CreateAgentTelemetryInput = {
  identityId: string;
  threadId?: string;
  mode: AgentMode;
  correlationId: string;
};

type CreateLangSmithTelemetryInput = {
  client: Client;
  hideInputs: boolean;
  hideOutputs: boolean;
  metadata: Record<string, unknown>;
  mode: AgentMode;
  projectName: string;
};

type PseudonymizeInput = {
  runtime: AgentObservabilityRuntime;
  domain: 'identity' | 'thread';
  value: string;
};

type AgentObservabilityRuntime = {
  client: Client;
  environment: DeploymentEnvironment;
  hashKey: Buffer;
  hideInputs: boolean;
  hideOutputs: boolean;
  projectName: string;
  release?: string;
};

type ObservabilityConfigResult =
  | {
      ok: true;
      apiKey: string;
      endpoint: typeof LANGSMITH_EU_ENDPOINT;
      environment: DeploymentEnvironment;
      hashKey: Buffer;
      hideInputs: boolean;
      hideOutputs: boolean;
      projectName: string;
      release?: string;
      tracingSamplingRate: number;
      workspaceId?: string;
    }
  | {
      ok: false;
      reason?:
        | 'invalid_eu_endpoint'
        | 'invalid_content_capture_setting'
        | 'invalid_hash_key'
        | 'invalid_sampling_rate'
        | 'missing_api_key'
        | 'missing_project'
    };

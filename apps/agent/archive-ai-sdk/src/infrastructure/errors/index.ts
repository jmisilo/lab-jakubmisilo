export const AppErrorCode = {
  BOT_ATTACHMENT_DOWNLOAD_FAILED: 'BOT_ATTACHMENT_DOWNLOAD_FAILED',
  BOT_ATTACHMENT_INVALID: 'BOT_ATTACHMENT_INVALID',
  BOT_ATTACHMENT_LIMIT_EXCEEDED: 'BOT_ATTACHMENT_LIMIT_EXCEEDED',
  BOT_ATTACHMENT_TOO_LARGE: 'BOT_ATTACHMENT_TOO_LARGE',
  BOT_ATTACHMENT_UNSUPPORTED: 'BOT_ATTACHMENT_UNSUPPORTED',
  BOT_EMPTY_RESPONSE: 'BOT_EMPTY_RESPONSE',
  BOT_HANDLER_NOT_CONFIGURED: 'BOT_HANDLER_NOT_CONFIGURED',
  BOT_MESSAGE_FAILED: 'BOT_MESSAGE_FAILED',
  BOT_TYPING_INDICATOR_TIMEOUT: 'BOT_TYPING_INDICATOR_TIMEOUT',
  GOOGLE_API_ERROR: 'GOOGLE_API_ERROR',
  GOOGLE_API_TIMEOUT: 'GOOGLE_API_TIMEOUT',
  GOOGLE_CONFIGURATION_INVALID: 'GOOGLE_CONFIGURATION_INVALID',
  GOOGLE_CONNECTION_REQUIRED: 'GOOGLE_CONNECTION_REQUIRED',
  GOOGLE_OAUTH_EXPIRED: 'GOOGLE_OAUTH_EXPIRED',
  GOOGLE_OAUTH_INVALID: 'GOOGLE_OAUTH_INVALID',
  GOOGLE_PERMISSION_REQUIRED: 'GOOGLE_PERMISSION_REQUIRED',
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  GOOGLE_CALENDAR_API_ERROR: 'GOOGLE_CALENDAR_API_ERROR',
  GOOGLE_CALENDAR_API_TIMEOUT: 'GOOGLE_CALENDAR_API_TIMEOUT',
  GOOGLE_CALENDAR_EVENT_AMBIGUOUS: 'GOOGLE_CALENDAR_EVENT_AMBIGUOUS',
  GOOGLE_CALENDAR_EVENT_NOT_FOUND: 'GOOGLE_CALENDAR_EVENT_NOT_FOUND',
  GOOGLE_CALENDAR_MUTATION_UNSAFE: 'GOOGLE_CALENDAR_MUTATION_UNSAFE',
  KNOWLEDGE_NODE_INVALID: 'KNOWLEDGE_NODE_INVALID',
  KNOWLEDGE_NODE_NOT_FOUND: 'KNOWLEDGE_NODE_NOT_FOUND',
  KNOWLEDGE_PARENT_NOT_FOUND: 'KNOWLEDGE_PARENT_NOT_FOUND',
  KNOWLEDGE_TREE_INVARIANT_FAILED: 'KNOWLEDGE_TREE_INVARIANT_FAILED',
  NUTRITION_DRAFT_NOT_FOUND: 'NUTRITION_DRAFT_NOT_FOUND',
  NUTRITION_GOAL_REQUIRED: 'NUTRITION_GOAL_REQUIRED',
  NUTRITION_INPUT_INVALID: 'NUTRITION_INPUT_INVALID',
  NUTRITION_MEAL_NOT_FOUND: 'NUTRITION_MEAL_NOT_FOUND',
  NUTRITION_PERSISTENCE_FAILED: 'NUTRITION_PERSISTENCE_FAILED',
  SCHEDULE_TASK_INVALID: 'SCHEDULE_TASK_INVALID',
  SCHEDULE_TASK_EXECUTION_FAILED: 'SCHEDULE_TASK_EXECUTION_FAILED',
  SCHEDULE_TASK_LIMIT_EXCEEDED: 'SCHEDULE_TASK_LIMIT_EXCEEDED',
  SCHEDULE_TASK_NOT_FOUND: 'SCHEDULE_TASK_NOT_FOUND',
  SCHEDULE_TASK_OCCURRENCE_NOT_PENDING: 'SCHEDULE_TASK_OCCURRENCE_NOT_PENDING',
  SCHEDULE_TASK_RUN_NOT_FOUND: 'SCHEDULE_TASK_RUN_NOT_FOUND',
  SCHEDULE_PROVIDER_ERROR: 'SCHEDULE_PROVIDER_ERROR',
  SCHEDULE_PROVIDER_UNAVAILABLE: 'SCHEDULE_PROVIDER_UNAVAILABLE',
  WEATHER_API_ERROR: 'WEATHER_API_ERROR',
  WEATHER_API_TIMEOUT: 'WEATHER_API_TIMEOUT',
  WEATHER_CONFIGURATION_INVALID: 'WEATHER_CONFIGURATION_INVALID',
  WEATHER_FORECAST_TARGET_UNAVAILABLE: 'WEATHER_FORECAST_TARGET_UNAVAILABLE',
  WEATHER_RESPONSE_INVALID: 'WEATHER_RESPONSE_INVALID',
  WORLD_CUP_API_ERROR: 'WORLD_CUP_API_ERROR',
  WORLD_CUP_API_TIMEOUT: 'WORLD_CUP_API_TIMEOUT',
  WORLD_CUP_RESPONSE_INVALID: 'WORLD_CUP_RESPONSE_INVALID',
  WORLD_CUP_SUBSCRIPTION_FAILED: 'WORLD_CUP_SUBSCRIPTION_FAILED',
} as const;

const SAFE_LOG_CONTEXT_TEXT_FIELDS = new Set([
  'action',
  'adapter',
  'attachmentType',
  'code',
  'field',
  'frequency',
  'method',
  'mimeType',
  'operation',
  'scheduleKind',
  'service',
  'status',
  'type',
]);

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly context: AppErrorContext;
  readonly retryable: boolean;
  readonly userMessage?: string;

  constructor({
    code,
    message,
    cause,
    context = {},
    retryable = false,
    userMessage,
  }: AppErrorInput) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.context = context;
    this.retryable = retryable;
    this.userMessage = userMessage;
  }

  static timeout({ context, timeoutMs, ...input }: TimeoutErrorInput) {
    return new AppError({
      ...input,
      context: {
        ...context,
        timeoutMs,
      },
      retryable: input.retryable ?? true,
    });
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}

export class ErrorService {
  static toUserFacingFailure(
    error: unknown,
    { fallbackCode, fallbackMessage, fallbackRetryable = true }: DescribeForUserInput,
  ): UserFacingFailure {
    if (AppError.is(error)) {
      return {
        code: error.code,
        message:
          error.userMessage ?? 'The assistant hit a known failure while handling that request.',
        retryable: error.retryable,
      };
    }

    return {
      code: fallbackCode,
      message: fallbackMessage,
      retryable: fallbackRetryable,
    };
  }

  static toSafeLog(error: unknown) {
    if (AppError.is(error)) {
      return {
        code: error.code,
        name: error.name,
        context: this.#getSafeContext(error.context),
        retryable: error.retryable,
        cause: this.#getCauseLog(error.cause),
      };
    }

    if (error instanceof Error) {
      return {
        code: this.#getStringField(error, 'code'),
        name: error.name,
        adapter: this.#getStringField(error, 'adapter'),
      };
    }

    return {
      name: 'NonErrorThrown',
      thrownType: typeof error,
    };
  }

  static #getSafeContext(context: AppErrorContext) {
    const safeContext: AppErrorContext = {};

    for (const [key, value] of Object.entries(context)) {
      if (key === 'issues' && Array.isArray(value)) {
        safeContext.issueCount = value.length;
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        safeContext[key] = value;
      } else if (typeof value === 'string' && this.#isSafeContextTextField(key)) {
        safeContext[key] = value;
      } else if (Array.isArray(value)) {
        if (this.#isSafeContextTextArray(key, value)) {
          safeContext[key] = value;
        } else {
          safeContext[`${key}Count`] = value.length;
        }
      }
    }

    return safeContext;
  }

  static #getCauseLog(cause: unknown) {
    if (!cause) {
      return undefined;
    }

    if (cause instanceof Error) {
      return {
        code: this.#getStringField(cause, 'code'),
        name: cause.name,
      };
    }

    return {
      name: 'NonErrorCause',
      causeType: typeof cause,
    };
  }

  static #isSafeContextTextField(field: string) {
    return SAFE_LOG_CONTEXT_TEXT_FIELDS.has(field) || field.endsWith('Id') || field.endsWith('Ids');
  }

  static #isSafeContextTextArray(field: string, value: unknown[]): value is string[] {
    return (
      (field === 'services' || field.endsWith('Ids')) &&
      value.every((item) => typeof item === 'string')
    );
  }

  static #getStringField(value: unknown, field: string) {
    if (!value || typeof value !== 'object' || !(field in value)) {
      return undefined;
    }

    const fieldValue = (value as Record<string, unknown>)[field];

    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : undefined;
  }
}

export type AppErrorContext = Record<string, unknown>;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];

export type UserFacingFailure = {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
};

type AppErrorInput = {
  code: AppErrorCode;
  message: string;
  cause?: unknown;
  context?: AppErrorContext;
  retryable?: boolean;
  userMessage?: string;
};

type TimeoutErrorInput = Omit<AppErrorInput, 'context'> & {
  context?: AppErrorContext;
  timeoutMs: number;
};

type DescribeForUserInput = {
  fallbackCode: AppErrorCode;
  fallbackMessage: string;
  fallbackRetryable?: boolean;
};

export const AppErrorCode = {
  BOT_EMPTY_RESPONSE: 'BOT_EMPTY_RESPONSE',
  BOT_HANDLER_NOT_CONFIGURED: 'BOT_HANDLER_NOT_CONFIGURED',
  BOT_MESSAGE_FAILED: 'BOT_MESSAGE_FAILED',
  BOT_TYPING_INDICATOR_TIMEOUT: 'BOT_TYPING_INDICATOR_TIMEOUT',
  KNOWLEDGE_NODE_INVALID: 'KNOWLEDGE_NODE_INVALID',
  KNOWLEDGE_NODE_NOT_FOUND: 'KNOWLEDGE_NODE_NOT_FOUND',
  KNOWLEDGE_PARENT_NOT_FOUND: 'KNOWLEDGE_PARENT_NOT_FOUND',
  KNOWLEDGE_TREE_INVARIANT_FAILED: 'KNOWLEDGE_TREE_INVARIANT_FAILED',
  SCHEDULE_TASK_INVALID: 'SCHEDULE_TASK_INVALID',
  SCHEDULE_TASK_EXECUTION_FAILED: 'SCHEDULE_TASK_EXECUTION_FAILED',
  SCHEDULE_TASK_LIMIT_EXCEEDED: 'SCHEDULE_TASK_LIMIT_EXCEEDED',
  SCHEDULE_TASK_NOT_FOUND: 'SCHEDULE_TASK_NOT_FOUND',
  SCHEDULE_TASK_RUN_NOT_FOUND: 'SCHEDULE_TASK_RUN_NOT_FOUND',
  SCHEDULE_PROVIDER_ERROR: 'SCHEDULE_PROVIDER_ERROR',
  SCHEDULE_PROVIDER_UNAVAILABLE: 'SCHEDULE_PROVIDER_UNAVAILABLE',
  WEATHER_API_ERROR: 'WEATHER_API_ERROR',
  WEATHER_API_TIMEOUT: 'WEATHER_API_TIMEOUT',
  WEATHER_FORECAST_TARGET_UNAVAILABLE: 'WEATHER_FORECAST_TARGET_UNAVAILABLE',
  WEATHER_RESPONSE_INVALID: 'WEATHER_RESPONSE_INVALID',
  WORLD_CUP_API_ERROR: 'WORLD_CUP_API_ERROR',
  WORLD_CUP_API_TIMEOUT: 'WORLD_CUP_API_TIMEOUT',
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];
export type AppErrorContext = Record<string, unknown>;

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
        message: error.message,
        context: error.context,
        retryable: error.retryable,
        cause: this.#getCauseLog(error.cause),
      };
    }

    if (error instanceof Error) {
      return {
        code: this.#getStringField(error, 'code'),
        name: error.name,
        message: error.message,
        adapter: this.#getStringField(error, 'adapter'),
      };
    }

    return {
      name: 'NonErrorThrown',
      message: String(error),
    };
  }

  static #getCauseLog(cause: unknown) {
    if (!cause) {
      return undefined;
    }

    if (cause instanceof Error) {
      return {
        code: this.#getStringField(cause, 'code'),
        name: cause.name,
        message: cause.message,
      };
    }

    return {
      name: 'NonErrorCause',
      message: String(cause),
    };
  }

  static #getStringField(value: unknown, field: string) {
    if (!value || typeof value !== 'object' || !(field in value)) {
      return undefined;
    }

    const fieldValue = (value as Record<string, unknown>)[field];

    return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : undefined;
  }
}

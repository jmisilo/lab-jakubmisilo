import { AppError, AppErrorCode, ErrorService } from '.';

describe('AppError', () => {
  it('creates stable coded timeout errors with structured context', () => {
    const error = AppError.timeout({
      code: AppErrorCode.ASSISTANT_GENERATE_TIMEOUT,
      message: 'Assistant response generation timed out.',
      context: {
        operation: 'assistant.generate',
      },
      timeoutMs: 30_000,
    });

    expect(error).toMatchObject({
      name: 'AppError',
      code: AppErrorCode.ASSISTANT_GENERATE_TIMEOUT,
      message: 'Assistant response generation timed out.',
      context: {
        operation: 'assistant.generate',
        timeoutMs: 30_000,
      },
      retryable: true,
    });
  });
});

describe('ErrorService.toUserFacingFailure', () => {
  it('preserves app error codes for user-facing failures', () => {
    const failure = ErrorService.toUserFacingFailure(
      new AppError({
        code: AppErrorCode.BOT_EMPTY_RESPONSE,
        message: 'Assistant generated an empty response.',
        retryable: true,
        userMessage: 'I generated an empty response, so Telegram could not send it.',
      }),
      {
        fallbackCode: AppErrorCode.BOT_MESSAGE_FAILED,
        fallbackMessage: 'The assistant failed while handling this chat message.',
      },
    );

    expect(failure).toEqual({
      code: AppErrorCode.BOT_EMPTY_RESPONSE,
      message: 'I generated an empty response, so Telegram could not send it.',
      retryable: true,
    });
  });

  it('uses stable fallback codes for unknown errors', () => {
    const failure = ErrorService.toUserFacingFailure(new Error('provider exploded'), {
      fallbackCode: AppErrorCode.BOT_MESSAGE_FAILED,
      fallbackMessage: 'The assistant failed while handling this chat message.',
    });

    expect(failure).toEqual({
      code: AppErrorCode.BOT_MESSAGE_FAILED,
      message: 'The assistant failed while handling this chat message.',
      retryable: true,
    });
  });
});

describe('ErrorService.toSafeLog', () => {
  it('keeps developer details in logs without exposing raw unknown values to users', () => {
    const error = new AppError({
      code: AppErrorCode.AI_GENERATE_TIMEOUT,
      message: 'AI text generation timed out.',
      context: {
        operation: 'ai.generate',
        timeoutMs: 30_000,
      },
      retryable: true,
    });

    expect(ErrorService.toSafeLog(error)).toEqual({
      code: AppErrorCode.AI_GENERATE_TIMEOUT,
      name: 'AppError',
      message: 'AI text generation timed out.',
      context: {
        operation: 'ai.generate',
        timeoutMs: 30_000,
      },
      retryable: true,
      cause: undefined,
    });
  });
});

import { AppError, AppErrorCode, ErrorService } from '.';

describe('AppError', () => {
  it('creates stable coded timeout errors with structured context', () => {
    const error = AppError.timeout({
      code: AppErrorCode.BOT_TYPING_INDICATOR_TIMEOUT,
      message: 'Typing indicator timed out.',
      context: {
        operation: 'bot.typing',
      },
      timeoutMs: 1_500,
    });

    expect(error).toMatchObject({
      name: 'AppError',
      code: AppErrorCode.BOT_TYPING_INDICATOR_TIMEOUT,
      message: 'Typing indicator timed out.',
      context: {
        operation: 'bot.typing',
        timeoutMs: 1_500,
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
      code: AppErrorCode.WORLD_CUP_API_TIMEOUT,
      message: 'World Cup API request timed out.',
      context: {
        operation: 'world-cup.fetch',
        timeoutMs: 10_000,
      },
      retryable: true,
    });

    expect(ErrorService.toSafeLog(error)).toEqual({
      code: AppErrorCode.WORLD_CUP_API_TIMEOUT,
      name: 'AppError',
      context: {
        operation: 'world-cup.fetch',
        timeoutMs: 10_000,
      },
      retryable: true,
      cause: undefined,
    });
  });

  it('omits untrusted error details instead of logging their raw values', () => {
    const error = new AppError({
      code: AppErrorCode.GOOGLE_API_ERROR,
      message: 'Google request failed for private@example.com.',
      context: {
        identityId: 'identity-1',
        operation: 'gmail.search',
        path: '/gmail/v1/users/private@example.com/messages',
        providerMessage: 'Authorization failed: access_token=secret-token',
        issues: [{ input: 'private email body', path: ['messages', 0] }],
      },
      cause: new Error('Database query included private@example.com'),
    });

    const safeError = ErrorService.toSafeLog(error);

    expect(safeError).toEqual({
      code: AppErrorCode.GOOGLE_API_ERROR,
      name: 'AppError',
      context: {
        identityId: 'identity-1',
        operation: 'gmail.search',
        issueCount: 1,
      },
      retryable: false,
      cause: {
        code: undefined,
        name: 'Error',
      },
    });
    expect(JSON.stringify(safeError)).not.toContain('private@example.com');
    expect(JSON.stringify(safeError)).not.toContain('secret-token');
    expect(JSON.stringify(safeError)).not.toContain('private email body');
  });
});

import { AppError, AppErrorCode } from '@/infrastructure/errors';

import { GoogleCalendarTokenEncryptionService } from './token-crypto';

const originalEncryptionKey = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY;

describe('GoogleCalendarTokenEncryptionService', () => {
  beforeEach(() => {
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterEach(() => {
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('encrypts and decrypts refresh tokens', () => {
    const encrypted = GoogleCalendarTokenEncryptionService.encryptToken('refresh-token-1');

    expect(encrypted.encryptedRefreshToken).not.toBe('refresh-token-1');
    expect(
      GoogleCalendarTokenEncryptionService.decryptToken({
        encryptedRefreshToken: encrypted.encryptedRefreshToken,
        refreshTokenIv: encrypted.refreshTokenIv,
        refreshTokenAuthTag: encrypted.refreshTokenAuthTag,
      }),
    ).toBe('refresh-token-1');
  });

  it('rejects invalid encryption key lengths', () => {
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');

    expect(() => GoogleCalendarTokenEncryptionService.encryptToken('refresh-token-1')).toThrow(
      'GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.',
    );
  });

  it('classifies invalid encryption key lengths as server configuration errors', () => {
    process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');

    try {
      GoogleCalendarTokenEncryptionService.assertConfigured();
      throw new Error('Expected assertConfigured to throw.');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      expect(error).toMatchObject({
        code: AppErrorCode.GOOGLE_CALENDAR_CONFIGURATION_INVALID,
        retryable: false,
        userMessage: 'Google Calendar is not configured correctly.',
      });
    }
  });
});

import { AppError, AppErrorCode } from '@/infrastructure/errors';

import { GoogleTokenEncryptionService } from './token-crypto';

const originalEncryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe('GoogleTokenEncryptionService', () => {
  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterEach(() => {
    restoreEnvironmentVariable('GOOGLE_TOKEN_ENCRYPTION_KEY', originalEncryptionKey);
  });

  it('encrypts and decrypts refresh tokens', () => {
    const encrypted = GoogleTokenEncryptionService.encryptToken('refresh-token-1');

    expect(encrypted.encryptedRefreshToken).not.toBe('refresh-token-1');
    expect(
      GoogleTokenEncryptionService.decryptToken({
        encryptedRefreshToken: encrypted.encryptedRefreshToken,
        refreshTokenIv: encrypted.refreshTokenIv,
        refreshTokenAuthTag: encrypted.refreshTokenAuthTag,
      }),
    ).toBe('refresh-token-1');
  });

  it('rejects invalid encryption key lengths', () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');

    expect(() => GoogleTokenEncryptionService.encryptToken('refresh-token-1')).toThrow(
      'GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.',
    );
  });

  it('classifies invalid encryption key lengths as server configuration errors', () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');

    try {
      GoogleTokenEncryptionService.assertConfigured();
      throw new Error('Expected assertConfigured to throw.');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      expect(error).toMatchObject({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        retryable: false,
        userMessage: 'Google is not configured correctly.',
      });
    }
  });

  it('preserves configuration errors when decrypting tokens', () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

    try {
      GoogleTokenEncryptionService.decryptToken({
        encryptedRefreshToken: 'encrypted',
        refreshTokenIv: 'iv',
        refreshTokenAuthTag: 'auth-tag',
      });
      throw new Error('Expected decryptToken to throw.');
    } catch (error) {
      expect(error).toMatchObject({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        retryable: false,
      });
    }
  });
});

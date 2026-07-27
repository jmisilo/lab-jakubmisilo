import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { AppError, AppErrorCode } from '@/infrastructure/errors';

const TOKEN_KEY_BYTES = 32;
const TOKEN_IV_BYTES = 12;
const TOKEN_ALGORITHM = 'aes-256-gcm';

export class GoogleTokenEncryptionService {
  static assertConfigured() {
    this.#getKey();
  }

  static encryptToken(value: string) {
    const iv = randomBytes(TOKEN_IV_BYTES);
    const cipher = createCipheriv(TOKEN_ALGORITHM, this.#getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedRefreshToken: encrypted.toString('base64'),
      refreshTokenIv: iv.toString('base64'),
      refreshTokenAuthTag: authTag.toString('base64'),
    };
  }

  static decryptToken({
    encryptedRefreshToken,
    refreshTokenIv,
    refreshTokenAuthTag,
  }: {
    encryptedRefreshToken: string;
    refreshTokenIv: string;
    refreshTokenAuthTag: string;
  }) {
    try {
      const decipher = createDecipheriv(
        TOKEN_ALGORITHM,
        this.#getKey(),
        Buffer.from(refreshTokenIv, 'base64'),
      );

      decipher.setAuthTag(Buffer.from(refreshTokenAuthTag, 'base64'));

      return Buffer.concat([
        decipher.update(Buffer.from(encryptedRefreshToken, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      if (AppError.is(error) && error.code === AppErrorCode.GOOGLE_CONFIGURATION_INVALID) {
        throw error;
      }

      throw new AppError({
        code: AppErrorCode.GOOGLE_TOKEN_INVALID,
        message: 'Google refresh token could not be decrypted.',
        cause: error,
        retryable: false,
        userMessage: 'Google access is invalid. Please reconnect.',
      });
    }
  }

  static #getKey() {
    const encodedKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

    if (!encodedKey) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        message: 'GOOGLE_TOKEN_ENCRYPTION_KEY is not configured.',
        retryable: false,
        userMessage: 'Google is not configured yet.',
      });
    }

    const key = Buffer.from(encodedKey, 'base64');

    if (key.byteLength !== TOKEN_KEY_BYTES) {
      throw new AppError({
        code: AppErrorCode.GOOGLE_CONFIGURATION_INVALID,
        message: 'GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.',
        retryable: false,
        userMessage: 'Google is not configured correctly.',
      });
    }

    return key;
  }
}

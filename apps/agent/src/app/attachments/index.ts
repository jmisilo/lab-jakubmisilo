import type { FilePart, ModelMessage } from 'ai';
import type { Attachment } from 'chat';

import sharp from 'sharp';

import { AppError, AppErrorCode } from '@/infrastructure/errors';

const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1_536;
const MAX_INPUT_PIXELS = 40_000_000;
const SUPPORTED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

export class AgentAttachmentService {
  static async addToLatestUserMessage({
    messages,
    attachments = [],
  }: AddAttachmentsToMessagesInput) {
    if (attachments.length === 0) {
      return messages;
    }

    if (attachments.length > MAX_ATTACHMENT_COUNT) {
      throw new AppError({
        code: AppErrorCode.BOT_ATTACHMENT_LIMIT_EXCEEDED,
        message: 'Incoming message contains too many attachments.',
        context: { attachmentCount: attachments.length, maxAttachmentCount: MAX_ATTACHMENT_COUNT },
        retryable: false,
        userMessage: 'Please send up to three attachments at a time.',
      });
    }

    const fileParts: FilePart[] = [];

    for (const [index, attachment] of attachments.entries()) {
      fileParts.push(await this.#prepareAttachment({ attachment, index }));
    }
    let latestUserMessageIndex = -1;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        latestUserMessageIndex = index;
        break;
      }
    }

    if (latestUserMessageIndex < 0) {
      throw new AppError({
        code: AppErrorCode.BOT_ATTACHMENT_INVALID,
        message: 'An attachment was received without a user message.',
        retryable: false,
        userMessage: 'I could not attach that file to your message.',
      });
    }

    const latestUserMessage = messages[latestUserMessageIndex];

    if (!latestUserMessage || latestUserMessage.role !== 'user') {
      throw new AppError({
        code: AppErrorCode.BOT_ATTACHMENT_INVALID,
        message: 'Latest user message could not be resolved for attachment.',
        retryable: false,
        userMessage: 'I could not attach that file to your message.',
      });
    }

    const existingContent =
      typeof latestUserMessage.content === 'string'
        ? [
            {
              type: 'text' as const,
              text: latestUserMessage.content || 'The user attached a file.',
            },
          ]
        : latestUserMessage.content;
    const messageWithAttachments: ModelMessage = {
      ...latestUserMessage,
      content: [...existingContent, ...fileParts],
    };

    return messages.map((message, index) =>
      index === latestUserMessageIndex ? messageWithAttachments : message,
    );
  }

  static async #prepareAttachment({ attachment, index }: PrepareAttachmentInput) {
    if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
      throw this.#attachmentTooLargeError(attachment.size);
    }

    const data = await this.#readAttachmentData(attachment);

    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw this.#attachmentTooLargeError(data.byteLength);
    }

    if (!this.#isImage(attachment)) {
      return {
        type: 'file' as const,
        data: { type: 'data' as const, data },
        filename: this.#sanitizeFilename(attachment.name, index),
        mediaType: attachment.mimeType?.trim() || 'application/octet-stream',
      };
    }

    return this.#normalizeImage({ attachment, data, index });
  }

  static async #normalizeImage({ attachment, data, index }: NormalizeImageInput) {
    try {
      const pipeline = sharp(data, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
        sequentialRead: true,
      });
      const metadata = await pipeline.metadata();

      if (!metadata.format || !SUPPORTED_IMAGE_FORMATS.has(metadata.format)) {
        throw this.#unsupportedAttachmentError(attachment, metadata.format);
      }

      const normalized = await pipeline
        .rotate()
        .resize({
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer();

      return {
        type: 'file' as const,
        data: { type: 'data' as const, data: normalized },
        filename: `image-${index + 1}.jpg`,
        mediaType: 'image/jpeg',
      };
    } catch (error) {
      if (AppError.is(error)) {
        throw error;
      }

      throw new AppError({
        code: AppErrorCode.BOT_ATTACHMENT_UNSUPPORTED,
        message: 'Incoming attachment could not be decoded as a supported image.',
        cause: error,
        context: {
          attachmentType: attachment.type,
          mimeType: attachment.mimeType,
          size: data.byteLength,
        },
        retryable: false,
        userMessage: 'Please send a valid JPEG, PNG, or WebP image.',
      });
    }
  }

  static async #readAttachmentData(attachment: Attachment) {
    if (Buffer.isBuffer(attachment.data)) {
      return attachment.data;
    }

    if (attachment.data instanceof Blob) {
      return Buffer.from(await attachment.data.arrayBuffer());
    }

    if (!attachment.fetchData) {
      throw new AppError({
        code: AppErrorCode.BOT_ATTACHMENT_DOWNLOAD_FAILED,
        message: 'Incoming attachment does not provide downloadable data.',
        context: { attachmentType: attachment.type, mimeType: attachment.mimeType },
        retryable: false,
        userMessage: 'I could not download that file. Please send it again.',
      });
    }

    try {
      return await attachment.fetchData();
    } catch (error) {
      throw new AppError({
        code: AppErrorCode.BOT_ATTACHMENT_DOWNLOAD_FAILED,
        message: 'Incoming attachment download failed.',
        cause: error,
        context: { attachmentType: attachment.type, mimeType: attachment.mimeType },
        retryable: true,
        userMessage: 'I could not download that file. Please send it again.',
      });
    }
  }

  static #attachmentTooLargeError(size: number) {
    return new AppError({
      code: AppErrorCode.BOT_ATTACHMENT_TOO_LARGE,
      message: 'Incoming attachment exceeds the application size limit.',
      context: { size, maxBytes: MAX_ATTACHMENT_BYTES },
      retryable: false,
      userMessage: 'That file is too large. Please keep each attachment under 7 MB.',
    });
  }

  static #unsupportedAttachmentError(attachment: Attachment, detectedFormat?: string) {
    return new AppError({
      code: AppErrorCode.BOT_ATTACHMENT_UNSUPPORTED,
      message: 'Incoming attachment type is not supported.',
      context: {
        attachmentType: attachment.type,
        mimeType: attachment.mimeType,
        detectedFormat,
      },
      retryable: false,
      userMessage: 'Please send a JPEG, PNG, or WebP image.',
    });
  }

  static #isImage(attachment: Attachment) {
    return attachment.type === 'image' || attachment.mimeType?.startsWith('image/') === true;
  }

  static #sanitizeFilename(filename: string | undefined, index: number) {
    const basename = filename?.split(/[\\/]/u).at(-1);
    const sanitized = basename
      ?.replace(/[^a-zA-Z0-9._ -]/gu, '_')
      .slice(0, 120)
      .trim();

    return sanitized || `attachment-${index + 1}.bin`;
  }
}

type AddAttachmentsToMessagesInput = {
  messages: ModelMessage[];
  attachments?: Attachment[];
};

type PrepareAttachmentInput = {
  attachment: Attachment;
  index: number;
};

type NormalizeImageInput = PrepareAttachmentInput & {
  data: Buffer;
};

import type { Attachment, Message, Thread } from 'chat';

import decodeHeic from 'heic-decode';
import sharp from 'sharp';

import { logger } from '../../../infrastructure/logger';

const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 3;
const MAX_TOTAL_ATTACHMENT_BYTES = 14 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1_536;
const MAX_IMAGE_PIXELS = 40_000_000;

export class AttachmentService {
  static async handleMessage(
    thread: Thread,
    message: Message,
    defaultHandler: (thread: Thread, message: Message) => Promise<void>,
  ) {
    try {
      if (message.attachments.length > MAX_ATTACHMENT_COUNT) {
        await thread.post('Please send up to three attachments at a time.');
        return;
      }

      this.#assertDeclaredAttachmentSizes(message.attachments);
      this.#assertDeclaredTotalSize(message.attachments);

      const preparedAttachments: Attachment[] = [];
      let totalBytes = 0;

      for (const attachment of message.attachments) {
        const prepared = await this.#prepare(attachment, MAX_TOTAL_ATTACHMENT_BYTES - totalBytes);

        totalBytes += prepared.accountedBytes;
        this.#assertTotalSize(totalBytes);
        preparedAttachments.push(prepared.attachment);
      }

      message.attachments = preparedAttachments;

      await defaultHandler(thread, message);
    } catch (error) {
      logger.warn('Incoming attachment rejected', {
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });

      await thread.post(
        error instanceof Error
          ? error.message
          : 'I could not read that attachment. Please send it again.',
      );
    }
  }

  static async #prepare(attachment: Attachment, remainingBytes: number) {
    if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Each attachment must be 7 MB or smaller.');
    }

    const data = await this.#readBounded(attachment, remainingBytes);

    if (!this.#isImage(attachment)) {
      return {
        attachment: {
          ...attachment,
          data,
          url: undefined,
          fetchData: async () => data,
        },
        accountedBytes: data.byteLength,
      };
    }

    try {
      const normalized = await this.#normalizeImage(data, attachment);

      return {
        attachment: {
          ...attachment,
          data: normalized,
          url: undefined,
          fetchData: async () => normalized,
          mimeType: 'image/jpeg',
          name: 'image.jpg',
          size: normalized.byteLength,
        },
        accountedBytes: Math.max(data.byteLength, normalized.byteLength),
      };
    } catch {
      throw new Error('Please send a valid JPEG, PNG, WebP, HEIC, or HEIF image.');
    }
  }

  static async #readBounded(attachment: Attachment, remainingBytes: number) {
    if (Buffer.isBuffer(attachment.data)) {
      return this.#assertSize(attachment.data, remainingBytes);
    }

    if (attachment.data instanceof Blob) {
      if (attachment.data.size > MAX_ATTACHMENT_BYTES) {
        throw new Error('Each attachment must be 7 MB or smaller.');
      }

      if (attachment.data.size > remainingBytes) {
        throw new Error('Please keep all attachments in a message under 14 MB total.');
      }

      return this.#assertSize(Buffer.from(await attachment.data.arrayBuffer()), remainingBytes);
    }

    if (attachment.fetchData) {
      if (
        (attachment.size === undefined && remainingBytes < MAX_ATTACHMENT_BYTES) ||
        (attachment.size !== undefined && attachment.size > remainingBytes)
      ) {
        throw new Error('Please keep all attachments in a message under 14 MB total.');
      }

      return this.#assertSize(await attachment.fetchData(), remainingBytes);
    }

    if (!attachment.url) {
      throw new Error('I could not download that attachment. Please send it again.');
    }

    const url = new URL(attachment.url);

    if (url.protocol !== 'https:') {
      throw new Error('I could not securely download that attachment.');
    }

    const response = await fetch(url, { redirect: 'error' });

    if (!response.ok || !response.body) {
      throw new Error('I could not download that attachment. Please send it again.');
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      totalBytes += chunk.value.byteLength;

      if (totalBytes > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new Error('Each attachment must be 7 MB or smaller.');
      }

      if (totalBytes > remainingBytes) {
        await reader.cancel();
        throw new Error('Please keep all attachments in a message under 14 MB total.');
      }

      chunks.push(Buffer.from(chunk.value));
    }

    return Buffer.concat(chunks);
  }

  static async #normalizeImage(data: Buffer, attachment: Attachment) {
    try {
      return await this.#toJpeg(
        sharp(data, {
          failOn: 'error',
          limitInputPixels: MAX_IMAGE_PIXELS,
          sequentialRead: true,
        }),
      );
    } catch (error) {
      if (!this.#isHeic(attachment)) {
        throw error;
      }

      const image = await decodeHeic({ buffer: data });

      if (image.width * image.height > MAX_IMAGE_PIXELS) {
        throw new Error('Image is too large to process safely.');
      }

      return this.#toJpeg(
        sharp(Buffer.from(image.data), {
          raw: {
            width: image.width,
            height: image.height,
            channels: 4,
          },
        }),
      );
    }
  }

  static async #toJpeg(image: sharp.Sharp) {
    return image
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  static #isImage(attachment: Attachment) {
    return attachment.type === 'image' || attachment.mimeType?.startsWith('image/') === true;
  }

  static #isHeic(attachment: Attachment) {
    return (
      attachment.mimeType === 'image/heic' ||
      attachment.mimeType === 'image/heif' ||
      attachment.name?.toLowerCase().endsWith('.heic') === true ||
      attachment.name?.toLowerCase().endsWith('.heif') === true
    );
  }

  static #assertSize(data: Buffer, remainingBytes: number) {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error('Each attachment must be 7 MB or smaller.');
    }

    if (data.byteLength > remainingBytes) {
      throw new Error('Please keep all attachments in a message under 14 MB total.');
    }

    return data;
  }

  static #assertDeclaredTotalSize(attachments: Attachment[]) {
    const totalBytes = attachments.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0);

    this.#assertTotalSize(totalBytes);
  }

  static #assertDeclaredAttachmentSizes(attachments: Attachment[]) {
    for (const attachment of attachments) {
      if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
        throw new Error('Each attachment must be 7 MB or smaller.');
      }
    }
  }

  static #assertTotalSize(totalBytes: number) {
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('Please keep all attachments in a message under 14 MB total.');
    }
  }
}

import type { Attachment, Message, Thread } from 'chat';

import sharp from 'sharp';

const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_DIMENSION = 1_536;
const MAX_IMAGE_PIXELS = 40_000_000;

export class AttachmentService {
  static async handleMessage(
    thread: Thread,
    message: Message,
    defaultHandler: (thread: Thread, message: Message) => Promise<void>,
  ) {
    try {
      const imageCount = message.attachments.filter(
        (attachment) => attachment.type === 'image',
      ).length;

      if (imageCount > MAX_IMAGE_COUNT) {
        await thread.post('Please send up to three images at a time.');
        return;
      }

      message.attachments = await Promise.all(
        message.attachments.map((attachment) => this.#prepare(attachment)),
      );
      await defaultHandler(thread, message);
    } catch (error) {
      console.warn('[ATTACHMENTS]: incoming attachment rejected', error);
      await thread.post(
        error instanceof Error
          ? error.message
          : 'I could not read that attachment. Please send it again.',
      );
    }
  }

  static async #prepare(attachment: Attachment) {
    if (attachment.size !== undefined && attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Each attachment must be 7 MB or smaller.');
    }

    const data = await this.#readBounded(attachment);

    if (attachment.type !== 'image') {
      return {
        ...attachment,
        data,
        url: undefined,
        fetchData: undefined,
      };
    }

    try {
      const normalized = await sharp(data, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS,
        sequentialRead: true,
      })
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

      return {
        ...attachment,
        data: normalized,
        url: undefined,
        fetchData: undefined,
        mimeType: 'image/jpeg',
        name: 'image.jpg',
        size: normalized.byteLength,
      };
    } catch {
      throw new Error('Please send a valid JPEG, PNG, WebP, HEIC, or HEIF image.');
    }
  }

  static async #readBounded(attachment: Attachment) {
    if (Buffer.isBuffer(attachment.data)) {
      return this.#assertSize(attachment.data);
    }

    if (attachment.data instanceof Blob) {
      return this.#assertSize(Buffer.from(await attachment.data.arrayBuffer()));
    }

    if (attachment.fetchData) {
      return this.#assertSize(await attachment.fetchData());
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

      chunks.push(Buffer.from(chunk.value));
    }

    return Buffer.concat(chunks);
  }

  static #assertSize(data: Buffer) {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error('Each attachment must be 7 MB or smaller.');
    }

    return data;
  }
}

import type { Message } from 'chat';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentService } from '.';

describe('AttachmentService', () => {
  it('keeps normalized images available through fetchData for Mastra channels', async () => {
    const image = await sharp({
      create: {
        background: '#ffffff',
        channels: 3,
        height: 1,
        width: 1,
      },
    })
      .png()
      .toBuffer();
    const message = {
      attachments: [
        {
          data: image,
          mimeType: 'image/png',
          name: 'meal.png',
          type: 'image',
        },
      ],
    } as Message;
    const forwardedMessage = await AttachmentService.prepareMessage(message);
    const attachment = forwardedMessage.attachments[0];

    expect(attachment?.mimeType).toBe('image/jpeg');
    expect(attachment?.fetchData).toBeTypeOf('function');

    const normalized = await attachment?.fetchData?.();
    const metadata = await sharp(normalized).metadata();

    expect(metadata.format).toBe('jpeg');
  });

  it('rejects more than three attachments across all attachment types', async () => {
    const message = {
      attachments: [
        createFileAttachment('first.pdf'),
        createFileAttachment('second.pdf'),
        createFileAttachment('first.mp4', 'video/mp4', 'video'),
        createFileAttachment('second.mp4', 'video/mp4', 'video'),
      ],
    } as Message;

    await expect(AttachmentService.prepareMessage(message)).rejects.toThrow(
      'Please send up to three attachments at a time.',
    );
  });

  it('rejects attachments whose declared aggregate size exceeds 14 MB before downloading', async () => {
    const fetchData = vi.fn();
    const message = {
      attachments: [
        createFileAttachment('first.pdf', 'application/pdf', 'file', {
          fetchData,
          size: 5 * 1024 * 1024,
        }),
        createFileAttachment('second.pdf', 'application/pdf', 'file', {
          fetchData,
          size: 5 * 1024 * 1024,
        }),
        createFileAttachment('third.pdf', 'application/pdf', 'file', {
          fetchData,
          size: 5 * 1024 * 1024,
        }),
      ],
    } as Message;

    await expect(AttachmentService.prepareMessage(message)).rejects.toThrow(
      'Please keep all attachments in a message under 14 MB total.',
    );

    expect(fetchData).not.toHaveBeenCalled();
  });

  it('rejects attachments whose downloaded aggregate size exceeds 14 MB', async () => {
    const data = Buffer.alloc(5 * 1024 * 1024);
    const fetchData = vi.fn(async () => data);
    const message = {
      attachments: [
        createFileAttachment('first.pdf', 'application/pdf', 'file', { fetchData }),
        createFileAttachment('second.pdf', 'application/pdf', 'file', { fetchData }),
        createFileAttachment('third.pdf', 'application/pdf', 'file', { fetchData }),
      ],
    } as Message;

    await expect(AttachmentService.prepareMessage(message)).rejects.toThrow(
      'Please keep all attachments in a message under 14 MB total.',
    );

    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('downloads attachments sequentially', async () => {
    let activeDownloads = 0;
    let maxActiveDownloads = 0;
    const fetchData = vi.fn(async () => {
      activeDownloads += 1;
      maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeDownloads -= 1;
      return Buffer.from('attachment');
    });
    const message = {
      attachments: [
        createFileAttachment('first.pdf', 'application/pdf', 'file', { fetchData }),
        createFileAttachment('second.pdf', 'application/pdf', 'file', { fetchData }),
        createFileAttachment('third.mp4', 'video/mp4', 'video', { fetchData }),
      ],
    } as Message;

    await AttachmentService.prepareMessage(message);

    expect(fetchData).toHaveBeenCalledTimes(3);
    expect(maxActiveDownloads).toBe(1);
  });
});

function createFileAttachment(
  name: string,
  mimeType = 'application/pdf',
  type: 'file' | 'video' = 'file',
  input: {
    fetchData?: () => Promise<Buffer>;
    size?: number;
  } = {},
) {
  return {
    type,
    mimeType,
    name,
    data: input.fetchData ? undefined : Buffer.from('attachment'),
    ...input,
  };
}

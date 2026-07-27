import type { Message, Thread } from 'chat';

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
    const thread = { post: vi.fn() } as unknown as Thread;
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
    let forwardedMessage: Message | undefined;

    await AttachmentService.handleMessage(thread, message, async (_thread, forwarded) => {
      forwardedMessage = forwarded;
    });

    const attachment = forwardedMessage?.attachments[0];

    expect(attachment?.mimeType).toBe('image/jpeg');
    expect(attachment?.fetchData).toBeTypeOf('function');

    const normalized = await attachment?.fetchData?.();
    const metadata = await sharp(normalized).metadata();

    expect(metadata.format).toBe('jpeg');
  });
});

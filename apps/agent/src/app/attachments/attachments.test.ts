import type { Attachment } from 'chat';

import sharp from 'sharp';

import { AgentAttachmentService } from '@/app/attachments';

describe('AgentAttachmentService', () => {
  it('returns the original messages when no attachment is present', async () => {
    const messages = [{ role: 'user' as const, content: 'What is this?' }];

    await expect(
      AgentAttachmentService.addToLatestUserMessage({ messages, attachments: [] }),
    ).resolves.toBe(messages);
  });

  it('normalizes images and adds them only to the latest user message', async () => {
    const source = await sharp({
      create: {
        width: 2_400,
        height: 1_200,
        channels: 3,
        background: '#f0a040',
      },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const messages = [
      { role: 'user' as const, content: 'Previous message' },
      { role: 'assistant' as const, content: 'Previous response' },
      { role: 'user' as const, content: 'Estimate this meal' },
    ];

    const result = await AgentAttachmentService.addToLatestUserMessage({
      messages,
      attachments: [
        createAttachment({ data: source, mimeType: 'image/png' }),
        createAttachment({ data: source, mimeType: 'image/png' }),
        createAttachment({ data: source, mimeType: 'image/png' }),
      ],
    });

    expect(result).not.toBe(messages);
    expect(result.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(result.at(-1)).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Estimate this meal' },
        {
          type: 'file',
          data: { type: 'data', data: expect.any(Buffer) },
          filename: 'image-1.jpg',
          mediaType: 'image/jpeg',
        },
        expect.objectContaining({ type: 'file', filename: 'image-2.jpg' }),
        expect.objectContaining({ type: 'file', filename: 'image-3.jpg' }),
      ],
    });

    const content = result.at(-1)?.content;

    if (!Array.isArray(content)) {
      throw new Error('Expected multipart user content.');
    }

    const file = content.find((part) => part.type === 'file');

    if (
      !file ||
      file.type !== 'file' ||
      typeof file.data !== 'object' ||
      file.data === null ||
      !('type' in file.data) ||
      file.data.type !== 'data' ||
      !Buffer.isBuffer(file.data.data)
    ) {
      throw new Error('Expected inline file data.');
    }

    const metadata = await sharp(file.data.data).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeLessThanOrEqual(1_536);
    expect(metadata.height).toBeLessThanOrEqual(1_536);
    expect(metadata.exif).toBeUndefined();
  });

  it('downloads private platform attachments through fetchData', async () => {
    const data = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const fetchData = jest.fn().mockResolvedValue(data);

    await AgentAttachmentService.addToLatestUserMessage({
      messages: [{ role: 'user', content: 'Photo' }],
      attachments: [createAttachment({ fetchData })],
    });

    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  it('passes PDFs and videos as generic current-turn file parts', async () => {
    const result = await AgentAttachmentService.addToLatestUserMessage({
      messages: [{ role: 'user', content: 'Review these' }],
      attachments: [
        createAttachment({
          type: 'file',
          data: Buffer.from('%PDF-1.7'),
          name: 'report.pdf',
          mimeType: 'application/pdf',
        }),
        createAttachment({
          type: 'video',
          data: Buffer.from('video-data'),
          name: 'clip.mp4',
          mimeType: 'video/mp4',
        }),
      ],
    });

    expect(result.at(-1)).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Review these' },
        expect.objectContaining({
          type: 'file',
          filename: 'report.pdf',
          mediaType: 'application/pdf',
        }),
        expect.objectContaining({
          type: 'file',
          filename: 'clip.mp4',
          mediaType: 'video/mp4',
        }),
      ],
    });
  });

  it('rejects more than three attachments', async () => {
    await expect(
      AgentAttachmentService.addToLatestUserMessage({
        messages: [{ role: 'user', content: 'Photos' }],
        attachments: [
          createAttachment(),
          createAttachment(),
          createAttachment(),
          createAttachment(),
        ],
      }),
    ).rejects.toMatchObject({ code: 'BOT_ATTACHMENT_LIMIT_EXCEEDED' });
  });

  it('rejects attachments larger than 7 MB before downloading', async () => {
    const fetchData = jest.fn();

    await expect(
      AgentAttachmentService.addToLatestUserMessage({
        messages: [{ role: 'user', content: 'Large photo' }],
        attachments: [createAttachment({ size: 7 * 1024 * 1024 + 1, fetchData })],
      }),
    ).rejects.toMatchObject({ code: 'BOT_ATTACHMENT_TOO_LARGE' });
    expect(fetchData).not.toHaveBeenCalled();
  });

  it('rejects unsupported or invalid image content', async () => {
    await expect(
      AgentAttachmentService.addToLatestUserMessage({
        messages: [{ role: 'user', content: 'File' }],
        attachments: [createAttachment({ type: 'file', data: Buffer.from('not an image') })],
      }),
    ).rejects.toMatchObject({ code: 'BOT_ATTACHMENT_UNSUPPORTED' });
  });
});

function createAttachment(input: Partial<Attachment> = {}): Attachment {
  return {
    type: 'image',
    name: 'source.png',
    mimeType: 'image/png',
    ...input,
  };
}

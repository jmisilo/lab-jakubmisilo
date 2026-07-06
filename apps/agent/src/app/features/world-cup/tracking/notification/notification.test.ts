import type { WorldCupNotificationBot } from '@/app/features/world-cup/tracking/notification';
import type { WorldCupDetectedEvent } from '@/app/features/world-cup/types';

import { WorldCupNotificationAttachmentService } from '@/app/features/world-cup/tracking/notification/attachment';
import { AgentMemoryService } from '@/app/memory';
import { AIService } from '@/infrastructure/ai';

import { WorldCupNotificationService } from '.';

jest.mock('@/infrastructure/ai', () => ({
  AIService: {
    generate: jest.fn(),
  },
}));

jest.mock('ai', () => ({
  Output: {
    object: jest.fn((input: Record<string, unknown>) => ({
      type: 'object-output',
      ...input,
    })),
  },
}));

jest.mock('@/app/features/world-cup/tracking/notification/attachment', () => ({
  WorldCupNotificationAttachmentService: {
    createAttachment: jest.fn(),
  },
}));

jest.mock('@/app/memory', () => ({
  AgentMemoryService: {
    buildContext: jest.fn(),
  },
}));

const aiMock = jest.mocked(AIService);
const attachmentMock = jest.mocked(WorldCupNotificationAttachmentService);
const memoryMock = jest.mocked(AgentMemoryService);

describe('WorldCupNotificationService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    aiMock.generate.mockResolvedValue({
      text: 'Kickoff: 🇫🇷 France vs 🇦🇷 Argentina has started.',
    } as Awaited<ReturnType<typeof AIService.generate>>);
    attachmentMock.createAttachment.mockResolvedValue(attachment);
    memoryMock.buildContext.mockResolvedValue([]);
    threadMock.mockReturnValue({
      post: postMock,
    });
    postMock.mockResolvedValue(undefined);
    transcriptsListMock.mockResolvedValue([]);
  });

  it('posts the custom attachment before the text notification', async () => {
    await WorldCupNotificationService.postNotification({
      bot,
      event,
      identityId: 'identity-1',
      threadId: 'telegram:1',
    });

    expect(attachmentMock.createAttachment).toHaveBeenCalledWith(event);
    expect(postMock).toHaveBeenNthCalledWith(1, {
      attachments: [attachment],
      markdown: '',
    });
    expect(postMock).toHaveBeenNthCalledWith(2, {
      markdown: 'Kickoff: 🇫🇷 France vs 🇦🇷 Argentina has started.',
    });
  });

  it('still posts the text notification when attachment rendering fails', async () => {
    attachmentMock.createAttachment.mockRejectedValue(new Error('render failed'));

    await WorldCupNotificationService.postNotification({
      bot,
      event,
      identityId: 'identity-1',
      threadId: 'telegram:1',
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith({
      markdown: 'Kickoff: 🇫🇷 France vs 🇦🇷 Argentina has started.',
    });
  });
});

const postMock = jest.fn();
const threadMock = jest.fn();
const transcriptsListMock = jest.fn();

const bot = {
  thread: threadMock,
  transcripts: {
    list: transcriptsListMock,
  },
} as unknown as WorldCupNotificationBot;

const attachment = {
  data: Buffer.from('png'),
  height: 624,
  mimeType: 'image/png',
  name: 'world-cup-2026-kickoff-1.png',
  type: 'image' as const,
  width: 1440,
};

const event = {
  eventKey: 'world-cup-2026:kickoff:1',
  eventType: 'kickoff',
  gameId: '1',
  teamIds: ['33', '34'],
  payload: {
    eventType: 'kickoff',
    gameId: '1',
    matchLabel: 'France 0-0 Argentina',
    homeTeam: {
      id: '33',
      name: 'France',
      fifaCode: 'FRA',
      flagEmoji: '🇫🇷',
      score: 0,
      scorers: 'null',
    },
    awayTeam: {
      id: '34',
      name: 'Argentina',
      fifaCode: 'ARG',
      flagEmoji: '🇦🇷',
      score: 0,
      scorers: 'null',
    },
    localDate: '2026-06-17T18:00:00.000Z',
    timeElapsed: '1',
  },
} satisfies WorldCupDetectedEvent;

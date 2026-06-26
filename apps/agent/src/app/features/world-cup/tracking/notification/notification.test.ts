import type { WorldCupDetectedEvent } from '@/app/features/world-cup/types';
import type { Attachment } from 'chat';

import { AIService } from '@/app/ai';
import { WorldCupNotificationAttachmentService } from '@/app/features/world-cup/tracking/notification/attachment';
import { AgentMemoryService } from '@/app/memory';

import { WorldCupNotificationService } from '.';

jest.mock('@/app/ai', () => ({
  AIService: {
    generate: jest.fn(),
  },
}));

jest.mock('@/app/memory', () => ({
  AgentMemoryService: {
    buildContext: jest.fn(),
  },
}));

jest.mock('@/app/memory/context', () => ({
  AgentContextService: {
    contextSourceMessageLimit: 12,
  },
}));

jest.mock('@/app/features/world-cup/tracking/notification/attachment', () => ({
  WorldCupNotificationAttachmentService: {
    createAttachment: jest.fn(),
  },
}));

jest.mock('@/infrastructure/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const aiServiceMock = jest.mocked(AIService);
const memoryServiceMock = jest.mocked(AgentMemoryService);
const attachmentServiceMock = jest.mocked(WorldCupNotificationAttachmentService);

describe('WorldCupNotificationService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    aiServiceMock.generate.mockResolvedValue('Kickoff is live.');
    memoryServiceMock.buildContext.mockResolvedValue([]);
    attachmentServiceMock.createAttachment.mockResolvedValue(attachment);
  });

  it('posts a supported event attachment before the generated notification message', async () => {
    const post = jest.fn().mockResolvedValue(undefined);
    const bot = createBot({ post });

    await WorldCupNotificationService.postNotification({
      bot,
      event: createWorldCupEvent({ eventType: 'kickoff' }),
      identityId: 'identity-1',
      threadId: 'thread-1',
    });

    expect(attachmentServiceMock.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'kickoff' }),
    );
    expect(post).toHaveBeenNthCalledWith(1, {
      markdown: '',
      attachments: [attachment],
    });
    expect(post).toHaveBeenNthCalledWith(2, {
      markdown: 'Kickoff is live.',
    });
  });

  it('posts only the generated notification message when no attachment is available', async () => {
    const post = jest.fn().mockResolvedValue(undefined);
    const bot = createBot({ post });
    attachmentServiceMock.createAttachment.mockResolvedValue(null);

    await WorldCupNotificationService.postNotification({
      bot,
      event: createWorldCupEvent({ eventType: 'goal' }),
      identityId: 'identity-1',
      threadId: 'thread-1',
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      markdown: 'Kickoff is live.',
    });
  });
});

const attachment: Attachment = {
  data: Buffer.from('png'),
  height: 840,
  mimeType: 'image/png',
  name: 'world-cup-2026-kickoff-21.png',
  type: 'image',
  width: 1440,
};

const createBot = ({ post }: { post: jest.Mock }) =>
  ({
    thread: jest.fn(() => ({ post })),
    transcripts: {
      list: jest.fn().mockResolvedValue([]),
    },
  }) as never;

const createWorldCupEvent = ({
  eventType,
}: {
  eventType: WorldCupDetectedEvent['eventType'];
}): WorldCupDetectedEvent => ({
  eventKey: `world-cup-2026:${eventType}:21`,
  eventType,
  gameId: '21',
  teamIds: ['41', '42'],
  payload: {
    eventType,
    gameId: '21',
    matchLabel: 'Portugal 2-1 Democratic Republic of the Congo',
    homeTeam: {
      id: '41',
      name: 'Portugal',
      fifaCode: 'POR',
      flagEmoji: '🇵🇹',
      score: 2,
      scorers: 'Player 10',
    },
    awayTeam: {
      id: '42',
      name: 'Democratic Republic of the Congo',
      fifaCode: 'COD',
      flagEmoji: '🇨🇩',
      score: 1,
      scorers: 'Player 20',
    },
    localDate: '06/17/2026 12:00',
    timeElapsed: eventType === 'game-end' ? 'finished' : '1',
  },
});

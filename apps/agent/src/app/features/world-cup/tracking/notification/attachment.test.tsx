import type { WorldCupDetectedEvent } from '@/app/features/world-cup/types';
import type { ReactNode } from 'react';

const mockRenderWorldCupAttachmentToPng = jest.fn();

jest.mock(
  '@/app/features/world-cup/tracking/notification/renderer',
  () => ({
    loadEmojiImageDataUrl: jest.fn().mockResolvedValue('data:image/svg+xml;base64,emoji'),
    renderWorldCupAttachmentToPng: mockRenderWorldCupAttachmentToPng,
  }),
  { virtual: true },
);

jest.mock(
  '@message-ui/components',
  () => {
    const react = jest.requireActual<typeof import('react')>('react');
    const Component = ({ children }: { children?: ReactNode }) =>
      react.createElement('div', null, children);

    return {
      Attachment: Component,
      Column: Component,
      Heading: Component,
      Image: Component,
      Row: Component,
      Section: Component,
      Spacer: Component,
      Text: Component,
    };
  },
  { virtual: true },
);

let WorldCupNotificationAttachmentService: typeof import('./attachment').WorldCupNotificationAttachmentService;

beforeAll(async () => {
  ({ WorldCupNotificationAttachmentService } = await import('./attachment'));
});

describe('WorldCupNotificationAttachmentService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockRenderWorldCupAttachmentToPng.mockResolvedValue(Buffer.from('png'));
  });

  it('renders kickoff notifications as image attachments', async () => {
    const attachment = await WorldCupNotificationAttachmentService.createAttachment(
      createWorldCupEvent({ eventType: 'kickoff' }),
    );

    expect(mockRenderWorldCupAttachmentToPng).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: 720,
        height: 312,
        scale: 2,
      }),
    );
    expect(attachment).toEqual({
      data: Buffer.from('png'),
      height: 624,
      mimeType: 'image/png',
      name: 'world-cup-2026-kickoff-21.png',
      size: 3,
      type: 'image',
      width: 1440,
    });
  });

  it('renders game-end notifications as image attachments', async () => {
    const attachment = await WorldCupNotificationAttachmentService.createAttachment(
      createWorldCupEvent({ eventType: 'game-end' }),
    );

    expect(mockRenderWorldCupAttachmentToPng).toHaveBeenCalledTimes(1);
    expect(attachment).toEqual(
      expect.objectContaining({
        height: 720,
        name: 'world-cup-2026-game-end-21.png',
        size: 3,
        type: 'image',
      }),
    );
  });

  it('does not render attachments for other World Cup events', async () => {
    const attachment = await WorldCupNotificationAttachmentService.createAttachment(
      createWorldCupEvent({ eventType: 'goal' }),
    );

    expect(attachment).toBeNull();
    expect(mockRenderWorldCupAttachmentToPng).not.toHaveBeenCalled();
  });
});

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
    scoringTeam:
      eventType === 'goal'
        ? {
            id: '41',
            name: 'Portugal',
            fifaCode: 'POR',
            flagEmoji: '🇵🇹',
            scoreAfterGoal: 2,
            goalsDetected: 1,
            scorers: 'Player 10',
            scorerName: 'Player',
            goalMinute: '10',
          }
        : undefined,
  },
});
